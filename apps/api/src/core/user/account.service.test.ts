import { Repository } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { Invite } from '@/core/invite/entities/invite.entity';
import { Session } from '@/core/session/entities/session.entity';
import { KeyFetchToken } from '@/core/user/entities/key-fetch-token.entity';
import { PasswordChangeToken } from '@/core/user/entities/password-change-token.entity';
import { User } from '@/core/user/entities/user.entity';
import { PasswordReset } from '@/core/user/password-reset/entities/password-reset.entity';

import { InviteService } from '@/core/invite/invite.service';
import { SessionService } from '@/core/session/session.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';
import { AccountService, INewAccount } from '@/core/user/account.service';
import { PasswordResetService } from '@/core/user/password-reset/password-reset.service';
import { UserService } from '@/core/user/user.service';

import { hashToken } from '@/common/secret-token';
import { deriveTokenId } from '@/core/session/token-credentials';
import { createCredentials, stretchAuthPw, unwrapWrapKb } from '@/core/user/onepw';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const AUTH_PW = '247b675ffb4c46310bc87e26d712153abe5e1c90ef00a4784594f97ef54f2375';
const WRAP_KB = '34937143c59b20e4c4c2c3e8679a743cb2fcbe189431fa1b23e5e8a7fa22a8c1';
const CLIENT_SALT = 'identity.mozilla.com/picl/v1/quickStretchV2:0123456789abcdef0123456789abcdef';
const NEW_AUTH_PW = '1'.repeat(64);
const NEW_WRAP_KB = '2'.repeat(64);
const NEW_CLIENT_SALT = 'identity.mozilla.com/picl/v1/quickStretchV2:fedcba9876543210fedcba9876543210';

const create = (fields: Partial<INewAccount> = {}): INewAccount => ({
  email: 'New@Example.com',
  authPw: AUTH_PW,
  wrapKb: WRAP_KB,
  clientSalt: CLIENT_SALT,
  inviteToken: 'c'.repeat(64),
  ...fields,
});

describe('AccountService', () => {
  let user: User;
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let keyFetchTokens: Record<string, ReturnType<typeof vi.fn>>;
  let passwordChangeTokens: Record<string, ReturnType<typeof vi.fn>>;
  let sessionService: Record<string, ReturnType<typeof vi.fn>>;
  let recordPasswordChange: ReturnType<typeof vi.fn>;
  let recordKeyChange: ReturnType<typeof vi.fn>;
  let passwordResetService: Record<string, ReturnType<typeof vi.fn>>;
  let invalidateSessions: ReturnType<typeof vi.fn>;
  let inviteService: Record<string, ReturnType<typeof vi.fn>>;
  let updateRoles: ReturnType<typeof vi.fn>;
  let service: AccountService;

  beforeAll(async () => {
    user = new User({
      uid: 'f'.repeat(32),
      name: 'Tester',
      email: 'Tester@Example.com',
      locale: null,
      kA: '20'.repeat(32),
      credentials: await createCredentials(AUTH_PW, WRAP_KB, CLIENT_SALT),
      now: 1759230000123,
    });
    user.id = 7;
  });

  beforeEach(() => {
    users = {
      findOne: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      exists: vi.fn().mockResolvedValue(true),
    };
    keyFetchTokens = { insert: vi.fn(), delete: vi.fn().mockResolvedValue({ affected: 1 }), findOne: vi.fn() };
    passwordChangeTokens = { insert: vi.fn(), delete: vi.fn().mockResolvedValue({ affected: 1 }), findOne: vi.fn() };
    sessionService = {
      createSession: vi.fn().mockResolvedValue({ session: { authAt: 1759230000999 }, sessionToken: 'a'.repeat(64) }),
      findByTokenId: vi.fn(),
    };
    recordPasswordChange = vi.fn();
    recordKeyChange = vi.fn();
    passwordResetService = { check: vi.fn(), consume: vi.fn().mockResolvedValue(true), revoke: vi.fn() };
    invalidateSessions = vi.fn();
    inviteService = {
      findValid: vi.fn(),
      admits: vi.fn().mockReturnValue(true),
      consume: vi.fn().mockResolvedValue(true),
    };
    updateRoles = vi.fn();

    service = new AccountService(
      inviteService as unknown as InviteService,
      passwordResetService as unknown as PasswordResetService,
      sessionService as unknown as SessionService,
      { recordPasswordChange, recordKeyChange } as unknown as TokenserverService,
      { updateRoles, invalidateSessions } as unknown as UserService,
      users as unknown as Repository<User>,
      keyFetchTokens as unknown as Repository<KeyFetchToken>,
      passwordChangeTokens as unknown as Repository<PasswordChangeToken>
    );
  });

  describe('login', () => {
    it('signs in with the v2 authPW and returns the session and a keyFetchToken', async () => {
      users.findOne.mockResolvedValue(user);

      const signIn = await service.login('tester@example.com', AUTH_PW, true, null, false);

      expect(users.findOne).toHaveBeenCalledWith({ where: { normalizedEmail: 'tester@example.com' } });
      expect(signIn).toMatchObject({ user, session: { authAt: 1759230000999 }, sessionToken: 'a'.repeat(64) });
      expect(signIn.keyFetchToken).toMatch(/^[0-9a-f]{64}$/);
      expect(keyFetchTokens.insert).toHaveBeenCalledWith(
        expect.objectContaining({ bundle: expect.any(String) as string })
      );
    });

    it('creates no keyFetchToken unless keys were asked for', async () => {
      users.findOne.mockResolvedValue(user);

      expect((await service.login('Tester@Example.com', AUTH_PW, false, null, false)).keyFetchToken).toBeNull();
    });

    it('refuses an unknown address and a disabled account', async () => {
      users.findOne.mockResolvedValueOnce(null);
      await expect(service.login('Tester@Example.com', AUTH_PW, false, null, false)).rejects.toMatchObject({
        refusal: { reason: 'unknown-account', email: 'Tester@Example.com' },
      });

      users.findOne.mockResolvedValueOnce(
        Object.assign(Object.create(User.prototype) as User, user, { enabled: false })
      );
      await expect(service.login('Tester@Example.com', AUTH_PW, false, null, false)).rejects.toMatchObject({
        refusal: { reason: 'account-disabled' },
      });
    });

    it('refuses a wrong password, naming the stored email when the case differs', async () => {
      users.findOne.mockResolvedValue(user);

      await expect(service.login('Tester@Example.com', '0'.repeat(64), false, null, false)).rejects.toMatchObject({
        refusal: { reason: 'incorrect-password' },
      });
      await expect(service.login('tester@example.com', '0'.repeat(64), false, null, false)).rejects.toMatchObject({
        refusal: { reason: 'incorrect-email-case', storedEmail: 'Tester@Example.com' },
      });
      expect(users.update).toHaveBeenCalledWith({ id: 7 }, { lastLoginFail: expect.any(Date) as Date });
    });

    it('refuses an account disabled while the password was checked, opening no session', async () => {
      users.findOne.mockResolvedValue(user);
      users.exists.mockResolvedValueOnce(false);

      await expect(service.login('Tester@Example.com', AUTH_PW, true, null, false)).rejects.toMatchObject({
        refusal: { reason: 'account-disabled' },
      });

      expect(users.exists).toHaveBeenCalledWith({ where: { id: 7, enabled: true } });
      expect(sessionService.createSession).not.toHaveBeenCalled();
      expect(keyFetchTokens.insert).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
    });

    it('refuses an account whose password changed while the old one was checked, opening no session', async () => {
      users.findOne.mockResolvedValue(user);
      users.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.login('Tester@Example.com', AUTH_PW, true, null, false)).rejects.toMatchObject({
        refusal: { reason: 'incorrect-password' },
      });

      expect(users.exists).toHaveBeenCalledWith({ where: { id: 7, verifierSetAt: user.verifierSetAt } });
      expect(sessionService.createSession).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('login for a relying party', () => {
    it('refuses an account held to first-time setup only once the password matches', async () => {
      const flagged = Object.assign(Object.create(User.prototype) as User, user, { mustChangePassword: true });
      users.findOne.mockResolvedValue(flagged);

      await expect(service.login('Tester@Example.com', '0'.repeat(64), false, null, true)).rejects.toMatchObject({
        refusal: { reason: 'incorrect-password' },
      });
      await expect(service.login('Tester@Example.com', AUTH_PW, false, null, true)).rejects.toMatchObject({
        refusal: { reason: 'setup-required' },
      });

      expect((await service.login('Tester@Example.com', AUTH_PW, false, null, false)).user).toBe(flagged);
    });
  });

  describe('startPasswordChange', () => {
    const resolved = () => ({ session: { id: 3 } as Session, user });

    it('hands out a keyFetchToken for the current wrapKb and a passwordChangeToken', async () => {
      const started = await service.startPasswordChange(resolved(), 'Tester@Example.com', AUTH_PW);

      expect(started.keyFetchToken).toMatch(/^[0-9a-f]{64}$/);
      expect(started.passwordChangeToken).toMatch(/^[0-9a-f]{64}$/);
      expect(passwordChangeTokens.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(passwordChangeTokens.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          tokenIdHash: hashToken(deriveTokenId(started.passwordChangeToken, 'passwordChangeToken').tokenId),
        })
      );
    });

    it('refuses a wrong password or another address as Mozilla does', async () => {
      await expect(service.startPasswordChange(resolved(), 'Tester@Example.com', '0'.repeat(64))).rejects.toMatchObject(
        { refusal: { reason: 'incorrect-password' } }
      );
      await expect(service.startPasswordChange(resolved(), 'tester@example.com', AUTH_PW)).resolves.toBeDefined();
      await expect(service.startPasswordChange(resolved(), 'other@example.com', AUTH_PW)).rejects.toMatchObject({
        refusal: { reason: 'incorrect-email-case', storedEmail: 'Tester@Example.com' },
      });
    });
  });

  describe('finishPasswordChange', () => {
    const TOKEN = 'd'.repeat(64);
    const authorization = `Bearer fxpc_${deriveTokenId(TOKEN, 'passwordChangeToken').tokenId}`;
    const newPassword = {
      authPw: NEW_AUTH_PW,
      wrapKb: NEW_WRAP_KB,
      clientSalt: NEW_CLIENT_SALT,
      sessionTokenId: 'e'.repeat(64),
    };
    const flaggedUser = () => Object.assign(Object.create(User.prototype) as User, user, { mustChangePassword: true });

    it('stores the new credentials, revokes everything and signs the caller in again', async () => {
      const account = Object.assign(Object.create(User.prototype) as User, user);
      passwordChangeTokens.findOne.mockResolvedValue({ id: 5, user: account, createdAt: Date.now() });
      sessionService.findByTokenId.mockResolvedValue({ id: 3, userId: 7 });

      const signIn = await service.finishPasswordChange(authorization, newPassword, true, null);

      expect(passwordChangeTokens.delete).toHaveBeenCalledWith({ id: 5 });

      const [where, fields] = users.update.mock.calls[0] as [unknown, Partial<User>];
      expect(where).toEqual({ id: 7 });
      expect(fields).toMatchObject({ clientSalt: NEW_CLIENT_SALT, mustChangePassword: false });
      expect(fields.verifierSetAt).toBeGreaterThan(user.verifierSetAt);
      expect(fields).not.toHaveProperty('keysChangedAt');
      expect(fields).not.toHaveProperty('kA');

      const stretched = await stretchAuthPw(NEW_AUTH_PW, String(fields.authSalt));
      expect(fields.verifyHash).toBe(stretched.verifyHash);
      expect(unwrapWrapKb(String(fields.wrapWrapKb), stretched.wrapwrapKey).toString('hex')).toBe(NEW_WRAP_KB);

      expect(invalidateSessions).toHaveBeenCalledWith(7);
      expect(keyFetchTokens.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(passwordResetService.revoke).toHaveBeenCalledWith(7);
      expect(recordPasswordChange).toHaveBeenCalledWith(user.uid, fields.verifierSetAt);
      expect(recordKeyChange).not.toHaveBeenCalled();
      expect(signIn).toMatchObject({ sessionToken: 'a'.repeat(64) });
      expect(signIn.keyFetchToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('re-keys an account held to first-time setup, discarding the wrapKb the client sent', async () => {
      const account = flaggedUser();
      passwordChangeTokens.findOne.mockResolvedValue({ id: 5, user: account, createdAt: Date.now() });
      sessionService.findByTokenId.mockResolvedValue({ id: 3, userId: 7 });

      const signIn = await service.finishPasswordChange(authorization, newPassword, true, null);

      const [, fields] = users.update.mock.calls[0] as [unknown, Partial<User>];
      expect(fields).toMatchObject({ mustChangePassword: false, keysChangedAt: fields.verifierSetAt });
      expect(fields.keysChangedAt).toBeGreaterThan(user.keysChangedAt);
      expect(fields.kA).toMatch(/^[0-9a-f]{64}$/);
      expect(fields.kA).not.toBe(user.kA);

      const stretched = await stretchAuthPw(NEW_AUTH_PW, String(fields.authSalt));
      expect(fields.verifyHash).toBe(stretched.verifyHash);
      const storedWrapKb = unwrapWrapKb(String(fields.wrapWrapKb), stretched.wrapwrapKey).toString('hex');
      expect(storedWrapKb).toMatch(/^[0-9a-f]{64}$/);
      expect(storedWrapKb).not.toBe(NEW_WRAP_KB);
      expect(recordKeyChange).toHaveBeenCalledWith(user.uid, fields.verifierSetAt);

      expect(keyFetchTokens.insert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, bundle: expect.any(String) as string })
      );
      expect(signIn.user).toMatchObject({
        mustChangePassword: false,
        kA: fields.kA,
        keysChangedAt: fields.verifierSetAt,
      });
    });

    it('refuses an unknown or expired token and a session of another account', async () => {
      passwordChangeTokens.findOne.mockResolvedValueOnce(null);
      await expect(service.finishPasswordChange(authorization, newPassword, false, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-password-change-token' },
      });

      passwordChangeTokens.findOne.mockResolvedValueOnce({ id: 5, user, createdAt: Date.now() - 16 * 60 * 1000 });
      await expect(service.finishPasswordChange(authorization, newPassword, false, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-password-change-token' },
      });
      expect(passwordChangeTokens.delete).toHaveBeenCalledWith({ id: 5 });

      passwordChangeTokens.findOne.mockResolvedValueOnce({ id: 6, user, createdAt: Date.now() });
      sessionService.findByTokenId.mockResolvedValueOnce({ id: 3, userId: 8 });
      await expect(service.finishPasswordChange(authorization, newPassword, false, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-session-token' },
      });

      expect(users.update).not.toHaveBeenCalled();
      expect(invalidateSessions).not.toHaveBeenCalled();
    });

    it('refuses a token a racing request has already spent', async () => {
      passwordChangeTokens.findOne.mockResolvedValue({ id: 5, user, createdAt: Date.now() });
      passwordChangeTokens.delete.mockResolvedValue({ affected: 0 });

      await expect(service.finishPasswordChange(authorization, newPassword, false, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-password-change-token' },
      });

      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const reset = { resetToken: 'b'.repeat(64), authPw: NEW_AUTH_PW, clientSalt: NEW_CLIENT_SALT };
    const pendingReset = (account: User): PasswordReset =>
      Object.assign(new PasswordReset({ tokenHash: 'x', userId: 7, expiresAt: Date.now() + 1000, now: 0 }), {
        id: 4,
        user: account,
      });

    it('re-keys the account under the new password, uses up the link, revokes everything and signs in', async () => {
      const account = Object.assign(Object.create(User.prototype) as User, user);
      const passwordReset = pendingReset(account);
      passwordResetService.check.mockResolvedValue({ passwordReset });

      const signIn = await service.resetPassword(reset, 'Firefox');

      expect(passwordResetService.check).toHaveBeenCalledWith(reset.resetToken);
      expect(passwordResetService.consume).toHaveBeenCalledWith(passwordReset);

      const [where, fields] = users.update.mock.calls[0] as [unknown, Partial<User>];
      expect(where).toEqual({ id: 7 });
      expect(fields).toMatchObject({
        clientSalt: NEW_CLIENT_SALT,
        mustChangePassword: false,
        keysChangedAt: fields.verifierSetAt,
      });
      expect(fields.verifierSetAt).toBeGreaterThan(user.verifierSetAt);
      expect(fields.kA).toMatch(/^[0-9a-f]{64}$/);
      expect(fields.kA).not.toBe(user.kA);

      const stretched = await stretchAuthPw(NEW_AUTH_PW, String(fields.authSalt));
      expect(fields.verifyHash).toBe(stretched.verifyHash);
      const storedWrapKb = unwrapWrapKb(String(fields.wrapWrapKb), stretched.wrapwrapKey).toString('hex');
      expect(storedWrapKb).not.toBe(WRAP_KB);

      expect(invalidateSessions).toHaveBeenCalledWith(7);
      expect(keyFetchTokens.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(passwordChangeTokens.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(recordKeyChange).toHaveBeenCalledWith(user.uid, fields.verifierSetAt);
      expect(recordPasswordChange).not.toHaveBeenCalled();

      expect(sessionService.createSession).toHaveBeenCalledWith(7, 'Firefox');
      expect(signIn).toMatchObject({ sessionToken: 'a'.repeat(64), keyFetchToken: null });
    });

    it('refuses a link that is not valid, and a disabled account, changing nothing', async () => {
      passwordResetService.check.mockResolvedValueOnce({ passwordReset: null });
      await expect(service.resetPassword(reset, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-link' },
      });

      passwordResetService.check.mockResolvedValueOnce({
        passwordReset: pendingReset(Object.assign(Object.create(User.prototype) as User, user, { enabled: false })),
      });
      await expect(service.resetPassword(reset, null)).rejects.toMatchObject({
        refusal: { reason: 'account-disabled' },
      });

      expect(users.update).not.toHaveBeenCalled();
      expect(invalidateSessions).not.toHaveBeenCalled();
    });

    it('refuses in its own terms when the account is disabled or changed again before the new session opens', async () => {
      passwordResetService.check.mockResolvedValue({
        passwordReset: pendingReset(Object.assign(Object.create(User.prototype) as User, user)),
      });

      users.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(service.resetPassword(reset, null)).rejects.toMatchObject({
        refusal: { reason: 'account-disabled' },
      });

      users.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(service.resetPassword(reset, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-link' },
      });

      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('refuses an account disabled after the link was checked, before changing the credentials', async () => {
      passwordResetService.check.mockResolvedValue({
        passwordReset: pendingReset(Object.assign(Object.create(User.prototype) as User, user)),
      });
      users.exists.mockResolvedValue(false);

      await expect(service.resetPassword(reset, null)).rejects.toMatchObject({
        refusal: { reason: 'account-disabled' },
      });

      expect(users.exists).toHaveBeenCalledWith({ where: { id: 7, enabled: true } });
      expect(users.update).not.toHaveBeenCalled();
      expect(recordKeyChange).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const invite = (fields: Partial<Invite> = {}) =>
      Object.assign(
        new Invite({
          tokenHash: hashToken('c'.repeat(64)),
          email: 'new@example.com',
          name: 'Nova Lee',
          admin: false,
          expiresAt: 0,
          now: 0,
        }),
        fields
      );

    it('creates the account from the invite, spends it and grants the admin roles it carries', async () => {
      inviteService.findValid.mockResolvedValue(invite({ admin: true }));
      users.findOne.mockResolvedValue(null);

      const signIn = await service.create(create(), true, 'en-GB', null);

      const inserted = users.insert.mock.calls[0][0] as User;
      expect(inserted).toMatchObject({
        name: 'Nova Lee',
        email: 'New@Example.com',
        normalizedEmail: 'new@example.com',
        locale: 'en-GB',
      });
      expect(inserted.clientSalt).toBe(CLIENT_SALT);
      expect(String(inserted.keysChangedAt)).toMatch(/^[0-9]{13}$/);
      expect(inserted.verifierSetAt).toBe(inserted.keysChangedAt);
      expect(updateRoles).toHaveBeenCalledWith([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], inserted.id);
      expect(inviteService.consume).toHaveBeenCalled();
      expect(signIn.keyFetchToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuses a missing or mismatched invite and an existing account', async () => {
      const invalidInvite = { refusal: { reason: 'invalid-invite' } };

      inviteService.findValid.mockResolvedValueOnce(null);
      await expect(service.create(create(), false, null, null)).rejects.toMatchObject(invalidInvite);

      inviteService.findValid.mockResolvedValueOnce(invite());
      inviteService.admits.mockReturnValueOnce(false);
      await expect(service.create(create(), false, null, null)).rejects.toMatchObject(invalidInvite);

      inviteService.findValid.mockResolvedValueOnce(invite());
      users.findOne.mockResolvedValueOnce(user);
      await expect(service.create(create(), false, null, null)).rejects.toMatchObject({
        refusal: { reason: 'account-exists', email: 'New@Example.com' },
      });

      expect(users.insert).not.toHaveBeenCalled();
    });

    it('refuses an invite revoked or spent while the sign-up ran, creating nothing', async () => {
      inviteService.findValid.mockResolvedValue(invite());
      users.findOne.mockResolvedValue(null);
      inviteService.consume.mockResolvedValue(false);

      await expect(service.create(create(), false, null, null)).rejects.toMatchObject({
        refusal: { reason: 'invalid-invite' },
      });

      expect(users.insert).not.toHaveBeenCalled();
      expect(updateRoles).not.toHaveBeenCalled();
    });
  });

  describe('fetchKeys', () => {
    it('returns the bundle once and deletes the token', async () => {
      keyFetchTokens.findOne.mockResolvedValue({ id: 4, bundle: 'bundle', createdAt: Date.now() });

      expect(await service.fetchKeys(`Bearer fxk_${'b'.repeat(64)}`)).toBe('bundle');
      expect(keyFetchTokens.delete).toHaveBeenCalledWith({ id: 4 });
    });

    it('refuses an unknown or expired token, spending an expired one', async () => {
      const invalidToken = { refusal: { reason: 'invalid-key-fetch-token' } };

      keyFetchTokens.findOne.mockResolvedValueOnce(null);
      await expect(service.fetchKeys(`Bearer fxk_${'b'.repeat(64)}`)).rejects.toMatchObject(invalidToken);

      keyFetchTokens.findOne.mockResolvedValueOnce({ id: 4, bundle: 'bundle', createdAt: Date.now() - 11 * 60 * 1000 });
      await expect(service.fetchKeys(`Bearer fxk_${'b'.repeat(64)}`)).rejects.toMatchObject(invalidToken);
      expect(keyFetchTokens.delete).toHaveBeenCalledWith({ id: 4 });
    });

    it('refuses a token a racing request has already spent', async () => {
      keyFetchTokens.findOne.mockResolvedValue({ id: 4, bundle: 'bundle', createdAt: Date.now() });
      keyFetchTokens.delete.mockResolvedValue({ affected: 0 });

      await expect(service.fetchKeys(`Bearer fxk_${'b'.repeat(64)}`)).rejects.toMatchObject({
        refusal: { reason: 'invalid-key-fetch-token' },
      });
    });
  });
});
