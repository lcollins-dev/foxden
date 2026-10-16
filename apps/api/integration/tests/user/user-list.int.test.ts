import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ListUserDto,
  UserListResponseDto,
  UserStatsResponseDto,
  UserListRole,
  UserListStatus,
  UserRoleId,
} from '@libs/dto';

import { getUserList, getUserStats, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

describe('Admin user list (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  it('matches the search term against both name and email', async () => {
    // The suite shares a database, so a per-test token keeps the result set deterministic.
    const marker = randomUUID();

    const byName = await createTestUser(app, { name: `list-${marker}-name` });
    const byEmail = await createTestUser(app);

    const nameResponse = await getUserList(app, token, {
      search: `list-${marker}`,
      status: UserListStatus.ALL,
    }).expect(200);

    expect(nameResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([byName.id]);

    const emailResponse = await getUserList(app, token, {
      search: byEmail.email,
      status: UserListStatus.ALL,
    }).expect(200);

    expect(emailResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([byEmail.id]);
  });

  it('filters by status', async () => {
    const marker = randomUUID();

    const enabled = await createTestUser(app, { name: `status-${marker}-on`, enabled: true });
    const disabled = await createTestUser(app, { name: `status-${marker}-off`, enabled: false });

    const search = `status-${marker}`;

    const allResponse = await getUserList(app, token, { search, status: UserListStatus.ALL }).expect(200);
    const allIds = allResponse.body.userList.map((user: ListUserDto) => user.id);
    expect(allIds).toHaveLength(2);
    expect(allIds).toContain(enabled.id);
    expect(allIds).toContain(disabled.id);

    const enabledResponse = await getUserList(app, token, { search, status: UserListStatus.ENABLED }).expect(200);
    expect(enabledResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([enabled.id]);

    const disabledResponse = await getUserList(app, token, { search, status: UserListStatus.DISABLED }).expect(200);
    expect(disabledResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([disabled.id]);
  });

  it('filters by role and reports the total across every page', async () => {
    const marker = randomUUID();

    const userAdmin = await createTestUser(app, { name: `role-${marker}-a`, roleIds: [UserRoleId.USER_ADMIN] });
    const systemAdmin = await createTestUser(app, { name: `role-${marker}-b`, roleIds: [UserRoleId.SYSTEM_ADMIN] });
    const plain = await createTestUser(app, { name: `role-${marker}-c` });

    const search = `role-${marker}`;
    const ids = (body: UserListResponseDto) => body.userList.map(user => user.id);

    const admins = (await getUserList(app, token, { search, status: UserListStatus.ALL, role: UserListRole.ADMIN }))
      .body as UserListResponseDto;
    expect(ids(admins)).toEqual([userAdmin.id, systemAdmin.id]);
    expect(admins.total).toBe(2);

    const users = (await getUserList(app, token, { search, status: UserListStatus.ALL, role: UserListRole.USER }))
      .body as UserListResponseDto;
    expect(ids(users)).toEqual([plain.id]);
    expect(users.total).toBe(1);

    const everyone = (await getUserList(app, token, { search, status: UserListStatus.ALL }))
      .body as UserListResponseDto;
    expect(everyone.total).toBe(3);
  });

  it('rejects a request with an unknown role', async () => {
    await getUserList(app, token, { status: UserListStatus.ALL, role: 'overlord' }).expect(400);
  });

  it('reports each account created date and when it was last active', async () => {
    const marker = randomUUID();

    const neverUsed = await createTestUser(app, { name: `active-${marker}-a` });
    const signedIn = await createTestUser(app, { name: `active-${marker}-b` });
    await login(app, signedIn.email);
    await dbQuery(app, 'UPDATE session SET "lastAccessAt" = ? WHERE "userId" = ?', [
      Date.parse('2026-01-02T03:04:05Z'),
      signedIn.id,
    ]);

    const response = await getUserList(app, token, { search: `active-${marker}`, status: UserListStatus.ALL }).expect(
      200
    );
    const [first, second] = response.body.userList as ListUserDto[];

    expect(first).toMatchObject({ id: neverUsed.id, lastActiveAt: null });
    expect(second).toMatchObject({ id: signedIn.id, lastActiveAt: '2026-01-02T03:04:05.000Z' });
    expect(Date.parse(first.createdDate)).not.toBeNaN();
  });

  it('rejects a request with an unknown status', async () => {
    await getUserList(app, token, { status: 'sideways' }).expect(400);
  });

  it('reports stats that split the total across enabled and disabled', async () => {
    await createTestUser(app, { enabled: false });

    const response = await getUserStats(app, token).expect(200);

    const { total, enabled, disabled } = response.body as UserStatsResponseDto;

    expect(total).toBe(enabled + disabled);
    expect(disabled).toBeGreaterThan(0);
  });
});
