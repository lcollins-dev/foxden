import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';
import { bytesToHex, stretchPasswordV2 } from '@libs/fxa-crypto';

import { DefaultAdminService } from '@/core/user/default-admin.service';
import { LAST_ADMIN_MESSAGE, UserService } from '@/core/user/user.service';

import { createTestUser } from '../../factories/user.factory';
import { dbQuery } from '../../utils/db';
import { applyGlobalMiddleware, createApp } from '@/app';

interface IAdminRow {
  id: number;
  uid: string;
  clientSalt: string;
  mustChangePassword: number;
}

// A production start: a fresh database without the test migrations' seeded admin, so this file owns its app.
describe('Default admin on a fresh server (integration, serial)', () => {
  let directory: string;
  let app: NestExpressApplication;

  const findAdmins = () =>
    dbQuery<IAdminRow>(
      app,
      'SELECT id, uid, "clientSalt", "mustChangePassword" FROM "user" WHERE "normalizedEmail" = ?',
      [DEFAULT_ADMIN.email]
    );

  const signIn = async (service?: string): Promise<request.Response> => {
    const [admin] = await findAdmins();
    const stretched = await stretchPasswordV2(DEFAULT_ADMIN.password, admin.clientSalt);

    return request(app.getHttpServer())
      .post('/auth/v1/account/login')
      .send({ email: DEFAULT_ADMIN.email, authPW: bytesToHex(stretched.authPW), service });
  };

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'foxden-default-admin-'));

    process.env.DATABASE_PATH = join(directory, 'fresh.sqlite');
    process.env.USE_TEST_MIGRATIONS = 'false';
    process.env.TYPEORM_MIGRATIONS_RUN = 'true';

    app = await createApp();
    applyGlobalMiddleware(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates the default admin with both admin roles, held to first-time setup', async () => {
    const admins = await findAdmins();

    expect(admins).toHaveLength(1);
    expect(admins[0].mustChangePassword).toBe(1);

    const roles = await dbQuery<{ userRoleId: number }>(
      app,
      'SELECT "userRoleId" FROM "user_user_role" WHERE "userId" = ? ORDER BY "userRoleId"',
      [admins[0].id]
    );
    expect(roles.map(role => role.userRoleId)).toEqual([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]);
  });

  it('signs the web app in with the documented password and refuses the Firefox sign-in', async () => {
    await signIn().then(response => expect(response.status).toBe(200));

    const firefox = await signIn('sync');

    expect(firefox.status).toBe(400);
    expect(firefox.body.errno).toBe(250);
  });

  it('creates no second admin on the next start', async () => {
    const [before] = await findAdmins();

    await app.get(DefaultAdminService).onApplicationBootstrap();

    const after = await findAdmins();
    const accounts = await dbQuery(app, 'SELECT id FROM "user"');

    expect(after).toEqual([before]);
    expect(accounts).toHaveLength(1);
  });

  it('counts only enabled user admins as the one that has to remain', async () => {
    const [admin] = await findAdmins();
    const userService = app.get(UserService);

    const expectRefused = () =>
      expect(userService.updateRoles([UserRoleId.SYSTEM_ADMIN], admin.id)).rejects.toThrow(LAST_ADMIN_MESSAGE);

    await expectRefused();

    await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN], enabled: false });
    await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    await expectRefused();

    await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    await userService.updateRoles([UserRoleId.SYSTEM_ADMIN], admin.id);

    expect(await findAdmins()).toHaveLength(1);
  });
});
