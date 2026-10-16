import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { InviteListResponseDto, InviteState, PendingInviteDto, UserRoleId } from '@libs/dto';

import { checkInvite, inviteToken, listInvites, revokeInvite } from '../../clients/invite.client';
import { createInvite, login } from '../../clients/user.client';
import { signUpAccount } from '../../factories/account.factory';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const DAY_MS = 24 * 60 * 60 * 1000;

const NAME = 'Int Invitee';

const newEmail = (): string => `int-invite-${randomUUID()}@foxden.test`;

describe('Invites (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  const invite = async (email = newEmail(), admin = false): Promise<{ email: string; token: string }> => {
    const response = await createInvite(app, token, { email, name: NAME, admin }).expect(201);

    return { email, token: inviteToken(response.body.link) };
  };

  const setExpiresAt = (email: string, expiresAt: number) =>
    dbQuery(app, 'UPDATE invite SET "expiresAt" = ? WHERE email = ?', [expiresAt, email]);

  const pendingList = async (): Promise<PendingInviteDto[]> =>
    ((await listInvites(app, token).expect(200)).body as InviteListResponseDto).inviteList;

  describe('checking', () => {
    it('answers a valid invite with its address, admin flag and expiry', async () => {
      const created = await invite(newEmail(), true);

      const response = await checkInvite(app, created.token).expect(200);

      expect(response.body).toEqual({
        state: InviteState.VALID,
        invite: { email: created.email, admin: true, expiresAt: expect.any(String) },
      });
    });

    it('answers invalid for a token no invite has', async () => {
      const response = await checkInvite(app, randomBytes(32).toString('hex')).expect(200);

      expect(response.body).toEqual({ state: InviteState.INVALID, invite: null });
    });

    it('answers expired for an unused invite past its expiry', async () => {
      const created = await invite();
      await setExpiresAt(created.email, Date.now() - 1000);

      const response = await checkInvite(app, created.token).expect(200);

      expect(response.body).toEqual({ state: InviteState.EXPIRED, invite: null });
    });

    it('answers used once an account was created with it, even after it expires, and refuses it again', async () => {
      const account = await signUpAccount(app, 'invite used password');

      expect((await checkInvite(app, account.inviteToken).expect(200)).body).toEqual({
        state: InviteState.USED,
        invite: null,
      });

      await setExpiresAt(account.email.toLowerCase(), Date.now() - 1000);

      expect((await checkInvite(app, account.inviteToken).expect(200)).body.state).toBe(InviteState.USED);

      const reused = await request(app.getHttpServer())
        .post('/auth/v1/account/create')
        .send({
          email: account.email,
          authPWVersion2: 'a'.repeat(64),
          wrapKbVersion2: 'b'.repeat(64),
          clientSalt: account.clientSalt,
          inviteToken: account.inviteToken,
        })
        .expect(400);

      expect(reused.body.errno).toBe(207);
    });

    it('names the account it admits after the invite', async () => {
      const account = await signUpAccount(app, 'invite name password', 'Robin Ash');

      const rows = await dbQuery<{ name: string }>(app, 'SELECT name FROM "user" WHERE id = ?', [account.id]);

      expect(rows).toEqual([{ name: 'Robin Ash' }]);
    });

    it('still refuses a malformed token', async () => {
      await checkInvite(app, 'not-hex').expect(400);
    });
  });

  describe('listing pending invites', () => {
    it('lists unused, unexpired invites newest first and reports that email is not configured', async () => {
      const older = await invite();
      const newer = await invite(newEmail(), true);
      const expired = await invite();
      await setExpiresAt(expired.email, Date.now() - 1000);
      const used = await signUpAccount(app, 'invite list password');

      const response = await listInvites(app, token).expect(200);
      const emails = (response.body as InviteListResponseDto).inviteList.map(pending => pending.email);

      expect(response.body.emailConfigured).toBe(false);
      expect(emails.indexOf(newer.email)).toBeLessThan(emails.indexOf(older.email));
      expect(emails).toContain(older.email);
      expect(emails).not.toContain(expired.email);
      expect(emails).not.toContain(used.email.toLowerCase());

      const listed = (response.body as InviteListResponseDto).inviteList.find(pending => pending.email === newer.email);
      expect(listed).toEqual({
        id: expect.any(Number),
        email: newer.email,
        name: NAME,
        admin: true,
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });
    });

    it('is refused to an account without the user-admin role', async () => {
      const user = await createTestUser(app);

      await listInvites(app, await login(app, user.email)).expect(401);
    });
  });

  describe('revoking', () => {
    it('deletes a pending invite, so its link reads as invalid and the address can be invited again', async () => {
      const created = await invite();
      const pending = (await pendingList()).find(entry => entry.email === created.email);

      await revokeInvite(app, token, pending?.id ?? 0).expect(200);

      expect((await checkInvite(app, created.token).expect(200)).body.state).toBe(InviteState.INVALID);
      expect((await pendingList()).map(entry => entry.email)).not.toContain(created.email);

      await revokeInvite(app, token, pending?.id ?? 0).expect(404);
      await invite(created.email);
    });

    it('answers 404 for a used or expired invite, leaving it in place', async () => {
      const account = await signUpAccount(app, 'invite revoke password');
      const expired = await invite();
      await setExpiresAt(expired.email, Date.now() - 1000);

      const rows = await dbQuery<{ id: number; email: string }>(
        app,
        'SELECT id, email FROM invite WHERE email IN (?, ?)',
        [account.email.toLowerCase(), expired.email]
      );

      for (const row of rows) {
        await revokeInvite(app, token, row.id).expect(404);
      }

      expect((await checkInvite(app, account.inviteToken).expect(200)).body.state).toBe(InviteState.USED);
      expect((await checkInvite(app, expired.token).expect(200)).body.state).toBe(InviteState.EXPIRED);
    });

    it('is refused to an account without the user-admin role', async () => {
      const created = await invite();
      const pending = (await pendingList()).find(entry => entry.email === created.email);
      const user = await createTestUser(app);

      await revokeInvite(app, await login(app, user.email), pending?.id ?? 0).expect(401);
    });

    it('rejects an id that is not an integer', async () => {
      await revokeInvite(app, token, 'abc').expect(400);
    });
  });

  describe('validating', () => {
    it('refuses an invite without a name or with a one-character name', async () => {
      for (const body of [
        { email: newEmail(), admin: false },
        { email: newEmail(), name: 'R', admin: false },
      ]) {
        const response = await createInvite(app, token, body).expect(400);

        expect(response.body.message).toEqual([expect.objectContaining({ path: 'name', name: 'Name' })]);
      }
    });
  });

  describe('refusing duplicates', () => {
    it('refuses an address an account already has, in any case', async () => {
      const user = await createTestUser(app);

      const response = await createInvite(app, token, {
        email: user.email.toUpperCase(),
        name: NAME,
        admin: false,
      }).expect(400);

      expect(response.body.message).toEqual([
        expect.objectContaining({
          path: 'email',
          message: "There's already an account for this email.",
        }),
      ]);
    });

    it('refuses an address with a pending invite, in any case, until it expires', async () => {
      const created = await invite();

      const response = await createInvite(app, token, {
        email: created.email.toUpperCase(),
        name: NAME,
        admin: true,
      }).expect(400);

      expect(response.body.message).toEqual([
        expect.objectContaining({
          path: 'email',
          message: 'This email already has a pending invite. Revoke it below to send a new one.',
        }),
      ]);

      await setExpiresAt(created.email, Date.now() - 1000);
      await invite(created.email);
    });
  });

  it('keeps invites for 30 days past their expiry, then purges them when the next one is created', async () => {
    const recent = await invite();
    const old = await invite();
    await setExpiresAt(recent.email, Date.now() - 29 * DAY_MS);
    await setExpiresAt(old.email, Date.now() - 31 * DAY_MS);

    await invite();

    expect((await checkInvite(app, recent.token).expect(200)).body.state).toBe(InviteState.EXPIRED);
    expect((await checkInvite(app, old.token).expect(200)).body.state).toBe(InviteState.INVALID);
  });
});
