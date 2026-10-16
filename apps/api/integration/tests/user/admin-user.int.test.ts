import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import {
  createInvite,
  deleteUser,
  getProfile,
  getUser,
  login,
  updateUser,
  updateUserState,
} from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const loginRequest = (app: NestExpressApplication, email: string) =>
  request(app.getHttpServer())
    .post('/auth/v1/account/login')
    .send({ email, authPW: randomBytes(32).toString('hex') });

describe('Admin user management (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  describe('inviting', () => {
    it('returns a one-time link on the public origin and stores only its hash', async () => {
      const email = `int-invite-${randomUUID()}@foxden.test`;

      const response = await createInvite(app, token, { email, name: 'Int Invitee', admin: false }).expect(201);

      expect(response.body.link).toMatch(/^http:\/\/localhost:8080\/invite\/[0-9a-f]{64}$/);
      expect(response.body.emailSent).toBe(false);

      const inviteToken = String(response.body.link).split('/').pop();
      const rows = await dbQuery<{ tokenHash: string; email: string; admin: number }>(
        app,
        'SELECT "tokenHash", "email", "admin" FROM "invite" WHERE "email" = ?',
        [email]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(inviteToken);
      expect(rows[0].admin).toBe(0);
    });

    it('rejects a malformed email', async () => {
      await createInvite(app, token, { email: 'not-an-email', name: 'Int Invitee', admin: false }).expect(400);
    });

    it('is refused to an account without the user-admin role', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await createInvite(app, userToken, {
        email: `x-${randomUUID()}@foxden.test`,
        name: 'Int Invitee',
        admin: true,
      }).expect(401);
    });
  });

  describe('reading', () => {
    it('returns the user with role ids and serialised dates', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body).toMatchObject({
        id: user.id,
        uid: user.uid,
        email: user.email,
        enabled: true,
        userRoleIds: [UserRoleId.USER_ADMIN],
      });
      expect(typeof response.body.createdDate).toBe('string');
      expect(response.body.lastLoginSuccess).toBeNull();
    });

    it('rejects a user id that does not exist', async () => {
      await getUser(app, token, 2147483647).expect(400);
    });

    it('rejects a user id that is not an integer', async () => {
      await getUser(app, token, 'abc').expect(400);
    });
  });

  describe('updating', () => {
    it('renames the user and replaces the role set', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      await updateUser(app, token, user.id, {
        name: 'Renamed',
        email: user.email,
        userRoleIds: [UserRoleId.SYSTEM_ADMIN],
      }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body.name).toBe('Renamed');
      expect(response.body.userRoleIds).toEqual([UserRoleId.SYSTEM_ADMIN]);
    });

    it('rejects a name below the minimum length', async () => {
      const user = await createTestUser(app);

      for (const name of ['', 'J']) {
        await updateUser(app, token, user.id, { name, email: user.email, userRoleIds: [] }).expect(400);
      }
    });

    it('strips every role when an empty set is sent', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      await updateUser(app, token, user.id, { name: user.name, email: user.email, userRoleIds: [] }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body.userRoleIds).toEqual([]);
    });

    it('leaves the session alone when the account is renamed', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await updateUser(app, token, user.id, { name: 'Renamed', email: user.email, userRoleIds: [] }).expect(200);

      await getProfile(app, userToken).expect(200);
    });

    it('rejects an email already held by another user', async () => {
      const user = await createTestUser(app);
      const other = await createTestUser(app);

      await updateUser(app, token, user.id, { name: user.name, email: other.email, userRoleIds: [] }).expect(400);
    });

    it('rejects a user id that does not exist', async () => {
      await updateUser(app, token, 2147483647, {
        name: 'Ghost',
        email: `int-admin-${randomUUID()}@foxden.test`,
        userRoleIds: [],
      }).expect(400);
    });
  });

  describe('enabling and disabling', () => {
    it('records the account as disabled', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);
      expect(response.body.enabled).toBe(false);

      const rows = await dbQuery<{ enabled: number }>(app, 'SELECT enabled FROM "user" WHERE id = ?', [user.id]);
      expect(rows[0].enabled).toBe(0);
    });

    it('refuses to sign a disabled account in with errno 240', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      const response = await loginRequest(app, user.email).expect(400);

      expect(response.body.errno).toBe(240);
    });

    it('invalidates the session of a user who is disabled after signing in', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      await getProfile(app, userToken).expect(401);
    });

    it('lets a re-enabled user back in', async () => {
      const user = await createTestUser(app, { enabled: false });

      await updateUserState(app, token, user.id, { enabled: true }).expect(200);

      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);
    });

    it('rejects a non-boolean enabled flag', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: 'yes' }).expect(400);
    });

    it('rejects a user id that does not exist', async () => {
      await updateUserState(app, token, 2147483647, { enabled: false }).expect(400);
    });
  });

  describe("protecting the caller's own account", () => {
    const OWN_ACCOUNT_MESSAGE = 'Another admin has to change your role, disable or delete your account.';
    const OWN_PROFILE_MESSAGE = 'Change your own name and email in Profile & security.';

    it('refuses to disable it', async () => {
      const response = await updateUserState(app, token, admin.id, { enabled: false }).expect(400);

      expect(response.body.message).toBe(OWN_ACCOUNT_MESSAGE);
      await getProfile(app, token).expect(200);
    });

    it('refuses to change its roles', async () => {
      const response = await updateUser(app, token, admin.id, {
        name: admin.name,
        email: admin.email,
        userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
      }).expect(400);

      expect(response.body.message).toBe(OWN_ACCOUNT_MESSAGE);
    });

    it('refuses to change its name or email, and accepts it sent unchanged', async () => {
      const renamed = await updateUser(app, token, admin.id, {
        name: 'Renamed Admin',
        email: admin.email,
        userRoleIds: [UserRoleId.USER_ADMIN],
      }).expect(400);

      expect(renamed.body.message).toBe(OWN_PROFILE_MESSAGE);

      const readdressed = await updateUser(app, token, admin.id, {
        name: admin.name,
        email: `moved-${randomUUID()}@foxden.test`,
        userRoleIds: [UserRoleId.USER_ADMIN],
      }).expect(400);

      expect(readdressed.body.message).toBe(OWN_PROFILE_MESSAGE);

      await updateUser(app, token, admin.id, {
        name: admin.name,
        email: admin.email,
        userRoleIds: [UserRoleId.USER_ADMIN],
      }).expect(200);

      expect((await getUser(app, token, admin.id).expect(200)).body).toMatchObject({
        name: admin.name,
        email: admin.email,
        userRoleIds: [UserRoleId.USER_ADMIN],
      });
    });

    it('refuses to delete it', async () => {
      const response = await deleteUser(app, token, admin.id).expect(400);

      expect(response.body.message).toBe(OWN_ACCOUNT_MESSAGE);
      await getProfile(app, token).expect(200);
    });
  });
});
