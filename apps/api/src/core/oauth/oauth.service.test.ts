import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthorizationCode } from '@/core/oauth/entities/authorization-code.entity';
import { RefreshToken } from '@/core/oauth/entities/refresh-token.entity';
import { User } from '@/core/user/entities/user.entity';

import { AccessTokenService } from '@/core/oauth/access-token.service';
import { IAuthorizationRequest, OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';

import { hashToken } from '@/common/secret-token';
import { findClient, IOauthClient, OLDSYNC_SCOPE } from '@/core/oauth/oauth-clients';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const CLIENT_ID = '5882386c6d801776';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CODE = 'a'.repeat(64);

const client = findClient(CLIENT_ID) as IOauthClient;
const user = { id: 7, uid: 'f'.repeat(32), enabled: true, keysChangedAt: 1759230000123, verifierSetAt: 1759230000123 };
const resolved = { session: { id: 3, userId: 7, authAt: 1759230000000 }, user } as unknown as IResolvedSession;

const buildCode = (overrides: Partial<AuthorizationCode> = {}) => ({
  id: 1,
  codeHash: hashToken(CODE),
  userId: 7,
  sessionId: 4,
  clientId: CLIENT_ID,
  scope: `${OLDSYNC_SCOPE} profile`,
  keysJwe: 'header..iv.ciphertext.tag',
  codeChallenge: CHALLENGE,
  offline: true,
  authAt: 1759230000000,
  createdAt: Date.now(),
  session: { id: 4 },
  user,
  ...overrides,
});

describe('OauthService', () => {
  let codes: Record<string, ReturnType<typeof vi.fn>>;
  let refreshTokens: Record<string, ReturnType<typeof vi.fn>>;
  let mint: ReturnType<typeof vi.fn>;
  let revokeAllAccessTokens: ReturnType<typeof vi.fn>;
  let expireIfDue: ReturnType<typeof vi.fn>;
  let service: OauthService;

  beforeEach(() => {
    codes = { insert: vi.fn(), delete: vi.fn().mockResolvedValue({ affected: 1 }), findOne: vi.fn() };
    refreshTokens = { insert: vi.fn(), delete: vi.fn(), findOne: vi.fn(), update: vi.fn(), find: vi.fn() };
    mint = vi.fn().mockResolvedValue({ accessToken: 'jwt', expiresIn: 86400 });
    revokeAllAccessTokens = vi.fn();
    expireIfDue = vi.fn().mockResolvedValue(false);

    service = new OauthService(
      {
        mint,
        revoke: vi.fn().mockResolvedValue(false),
        revokeAllForUser: revokeAllAccessTokens,
        verify: vi.fn().mockResolvedValue(null),
      } as unknown as AccessTokenService,
      { expireIfDue } as unknown as SessionService,
      codes as unknown as Repository<AuthorizationCode>,
      refreshTokens as unknown as Repository<RefreshToken>
    );
  });

  describe('findClientWithThrow', () => {
    it('refuses a client that is not registered', () => {
      expect(() => service.findClientWithThrow('0000000000000000')).toThrow(
        expect.objectContaining({ refusal: { reason: 'unknown-client', clientId: '0000000000000000' } }) as unknown
      );
    });
  });

  describe('scopedKeys', () => {
    it('returns the oldsync metadata with a zero rotation secret and keysChangedAt', () => {
      expect(service.scopedKeys(user as User, CLIENT_ID, `profile ${OLDSYNC_SCOPE}`)).toEqual([
        { identifier: OLDSYNC_SCOPE, keyRotationSecret: '0'.repeat(64), keyRotationTimestamp: 1759230000123 },
      ]);
      expect(service.scopedKeys(user as User, CLIENT_ID, 'profile')).toEqual([]);
    });

    it('refuses an unknown client and an unknown scope', () => {
      expect(() => service.scopedKeys(user as User, '0000000000000000', 'profile')).toThrow(
        expect.objectContaining({
          refusal: expect.objectContaining({ reason: 'unknown-client' }) as unknown,
        }) as unknown
      );
      expect(() => service.scopedKeys(user as User, CLIENT_ID, 'https://identity.mozilla.com/apps/vpn')).toThrow(
        expect.objectContaining({
          refusal: { reason: 'invalid-scopes', invalidScopes: 'https://identity.mozilla.com/apps/vpn' },
        }) as unknown
      );
    });
  });

  describe('authorize', () => {
    const request = (fields: Partial<IAuthorizationRequest> = {}): IAuthorizationRequest => ({
      state: 'state',
      scope: `${OLDSYNC_SCOPE} profile`,
      codeChallenge: CHALLENGE,
      keysJwe: 'header..iv.ciphertext.tag',
      offline: true,
      ...fields,
    });

    it('stores the hashed code with the keys_jwe and the session and its auth time', async () => {
      const issued = await service.authorize(resolved, client, request());

      expect(issued.code).toMatch(/^[0-9a-f]{64}$/);
      expect(issued.redirect).toBe(
        `urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel?code=${issued.code}&state=state`
      );

      const stored = codes.insert.mock.calls[0][0] as AuthorizationCode;
      expect(stored).toMatchObject({
        codeHash: hashToken(issued.code),
        keysJwe: 'header..iv.ciphertext.tag',
        offline: true,
        authAt: 1759230000000,
        userId: 7,
        sessionId: 3,
      });
    });

    it('refuses a scope outside the allowed set', async () => {
      await expect(service.authorize(resolved, client, request({ scope: 'openid' }))).rejects.toMatchObject({
        refusal: { reason: 'invalid-scopes', invalidScopes: 'openid' },
      });
    });
  });

  describe('an account held to first-time setup', () => {
    const flagged = {
      session: resolved.session,
      user: { ...user, mustChangePassword: true },
    } as unknown as IResolvedSession;
    const setupRequired = { refusal: { reason: 'setup-required' } };

    it('gets no scoped keys, authorization code or access token', async () => {
      expect(() => service.scopedKeys(flagged.user, CLIENT_ID, OLDSYNC_SCOPE)).toThrow(
        expect.objectContaining(setupRequired)
      );
      await expect(
        service.authorize(flagged, client, {
          state: 'state',
          scope: OLDSYNC_SCOPE,
          codeChallenge: CHALLENGE,
          keysJwe: null,
          offline: false,
        })
      ).rejects.toMatchObject(setupRequired);
      await expect(service.grantFxaCredentials(client, flagged, OLDSYNC_SCOPE, undefined, false)).rejects.toMatchObject(
        setupRequired
      );
      expect(codes.insert).not.toHaveBeenCalled();
    });
  });

  describe('grantAuthorizationCode', () => {
    it('checks PKCE, spends the code and returns the keys_jwe and a refresh token, both tied to its session', async () => {
      codes.findOne.mockResolvedValue(buildCode());

      const granted = await service.grantAuthorizationCode(client, CODE, VERIFIER, undefined);

      expect(codes.delete).toHaveBeenCalledWith({ id: 1 });
      expect(granted).toMatchObject({
        accessToken: 'jwt',
        scope: `${OLDSYNC_SCOPE} profile`,
        authAt: 1759230000000,
        keysJwe: 'header..iv.ciphertext.tag',
      });
      expect(granted.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(refreshTokens.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: createHash('sha256')
            .update(Buffer.from(String(granted.refreshToken), 'hex'))
            .digest('hex'),
          sessionId: 4,
        })
      );
      expect(mint).toHaveBeenCalledWith(user, 4, CLIENT_ID, `${OLDSYNC_SCOPE} profile`, 1759230000000, undefined);
    });

    it('refuses an unknown, mismatched or expired code and a wrong verifier, as Mozilla does', async () => {
      codes.findOne.mockResolvedValueOnce(null);
      await expect(service.grantAuthorizationCode(client, CODE, VERIFIER, undefined)).rejects.toMatchObject({
        refusal: { reason: 'unknown-authorization-code' },
      });

      codes.findOne.mockResolvedValueOnce(buildCode({ clientId: '1111111111111111' }));
      await expect(service.grantAuthorizationCode(client, CODE, VERIFIER, undefined)).rejects.toMatchObject({
        refusal: { reason: 'mismatched-authorization-code', clientId: CLIENT_ID },
      });

      codes.findOne.mockResolvedValueOnce(buildCode({ createdAt: Date.now() - 11 * 60 * 1000 }));
      await expect(service.grantAuthorizationCode(client, CODE, VERIFIER, undefined)).rejects.toMatchObject({
        refusal: { reason: 'expired-authorization-code' },
      });

      codes.findOne.mockResolvedValueOnce(buildCode());
      await expect(service.grantAuthorizationCode(client, CODE, 'x'.repeat(43), undefined)).rejects.toMatchObject({
        refusal: { reason: 'invalid-pkce-challenge' },
      });
    });

    it('refuses a code a racing grant has already spent', async () => {
      codes.findOne.mockResolvedValue(buildCode());
      codes.delete.mockResolvedValue({ affected: 0 });

      await expect(service.grantAuthorizationCode(client, CODE, VERIFIER, undefined)).rejects.toMatchObject({
        refusal: { reason: 'unknown-authorization-code' },
      });
      expect(mint).not.toHaveBeenCalled();
    });

    it('refuses a code whose session has expired since it was issued', async () => {
      codes.findOne.mockResolvedValue(buildCode());
      expireIfDue.mockResolvedValue(true);

      await expect(service.grantAuthorizationCode(client, CODE, VERIFIER, undefined)).rejects.toMatchObject({
        refusal: { reason: 'unknown-authorization-code' },
      });
      expect(mint).not.toHaveBeenCalled();
    });

    it('issues no refresh token for an online code', async () => {
      codes.findOne.mockResolvedValue(buildCode({ offline: false, keysJwe: null }));

      const granted = await service.grantAuthorizationCode(client, CODE, VERIFIER, undefined);

      expect(granted.refreshToken).toBeNull();
      expect(granted.keysJwe).toBeNull();
    });
  });

  describe('grantFxaCredentials', () => {
    it('mints from the session with the requested ttl', async () => {
      const granted = await service.grantFxaCredentials(client, resolved, OLDSYNC_SCOPE, 21600, false);

      expect(mint).toHaveBeenCalledWith(user, 3, CLIENT_ID, OLDSYNC_SCOPE, 1759230000000, 21600);
      expect(granted).toMatchObject({ scope: OLDSYNC_SCOPE, authAt: 1759230000000, refreshToken: null });
    });

    it('ties an offline refresh token to the session', async () => {
      await service.grantFxaCredentials(client, resolved, OLDSYNC_SCOPE, undefined, true);

      expect(refreshTokens.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, sessionId: 3 }));
    });

    it('refuses a scope outside the allowed set', async () => {
      await expect(
        service.grantFxaCredentials(client, resolved, 'https://identity.mozilla.com/apps/vpn', undefined, false)
      ).rejects.toMatchObject({ refusal: { reason: 'invalid-scopes' } });
    });
  });

  describe('grantRefreshToken', () => {
    const stored = {
      id: 5,
      sessionId: 9,
      clientId: CLIENT_ID,
      scope: `${OLDSYNC_SCOPE} profile`,
      createdAt: 1759230000000,
      session: { id: 9 },
      user,
    };

    it('mints for a subset of the granted scope, with profile covering profile:*', async () => {
      refreshTokens.findOne.mockResolvedValue(stored);

      const granted = await service.grantRefreshToken(client, 'b'.repeat(64), 'profile:email', undefined);

      expect(granted).toMatchObject({ scope: 'profile:email', authAt: 1759230000000, refreshToken: null });
      expect(refreshTokens.update).toHaveBeenCalledWith({ id: 5 }, { lastUsedAt: expect.any(Number) as number });
    });

    it("ties the access token to the refresh token's session", async () => {
      refreshTokens.findOne.mockResolvedValue(stored);

      await service.grantRefreshToken(client, 'b'.repeat(64), undefined, 3600);

      expect(mint).toHaveBeenCalledWith(user, 9, CLIENT_ID, `${OLDSYNC_SCOPE} profile`, 1759230000000, 3600);
    });

    it('refuses a scope wider than the grant and an unknown token', async () => {
      refreshTokens.findOne.mockResolvedValueOnce({ ...stored, scope: 'profile' });
      await expect(service.grantRefreshToken(client, 'b'.repeat(64), OLDSYNC_SCOPE, undefined)).rejects.toMatchObject({
        refusal: { reason: 'invalid-scopes', invalidScopes: OLDSYNC_SCOPE },
      });

      refreshTokens.findOne.mockResolvedValueOnce(null);
      await expect(service.grantRefreshToken(client, 'b'.repeat(64), undefined, undefined)).rejects.toMatchObject({
        refusal: { reason: 'invalid-refresh-token' },
      });
    });

    it('refuses a token whose session has expired', async () => {
      refreshTokens.findOne.mockResolvedValue(stored);
      expireIfDue.mockResolvedValue(true);

      await expect(service.grantRefreshToken(client, 'b'.repeat(64), undefined, undefined)).rejects.toMatchObject({
        refusal: { reason: 'invalid-refresh-token' },
      });
      expect(mint).not.toHaveBeenCalled();
    });

    it('reports a token whose session has expired as inactive to introspection', async () => {
      refreshTokens.findOne.mockResolvedValue(stored);
      expireIfDue.mockResolvedValue(true);

      await expect(service.introspect('b'.repeat(64))).resolves.toBeNull();
    });
  });

  describe('resolveRefreshTokenSession', () => {
    const session = { id: 3, userId: 7 };
    const stored = { id: 5, clientId: 'a2270f727f45f648', scope: `profile ${OLDSYNC_SCOPE}`, session, user };

    it('resolves a refresh token carrying oldsync to the session it was issued under', async () => {
      refreshTokens.findOne.mockResolvedValue(stored);

      await expect(service.resolveRefreshTokenSession('B'.repeat(64))).resolves.toEqual({ session, user });
      expect(refreshTokens.update).toHaveBeenCalledWith({ id: 5 }, { lastUsedAt: expect.any(Number) as number });
    });

    it('refuses a token without oldsync, of an unknown client or a disabled account, and an unknown one', async () => {
      for (const found of [
        { ...stored, scope: 'profile' },
        { ...stored, clientId: '0000000000000000' },
        { ...stored, user: { ...user, enabled: false } },
        null,
      ]) {
        refreshTokens.findOne.mockResolvedValueOnce(found);

        await expect(service.resolveRefreshTokenSession('b'.repeat(64))).resolves.toBeNull();
      }
    });

    it('refuses a token whose session has expired', async () => {
      refreshTokens.findOne.mockResolvedValue(stored);
      expireIfDue.mockResolvedValue(true);

      await expect(service.resolveRefreshTokenSession('b'.repeat(64))).resolves.toBeNull();
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });

    it('does not look up anything that is not refresh-token shaped', async () => {
      await expect(service.resolveRefreshTokenSession('fxs_abc')).resolves.toBeNull();
      expect(refreshTokens.findOne).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('deletes a refresh token by the hash of its lowercased hex', async () => {
      await service.revoke('C'.repeat(64));

      expect(refreshTokens.delete).toHaveBeenCalledWith({ tokenHash: hashToken('c'.repeat(64)) });
    });

    it('leaves anything that is neither a JWT of ours nor refresh-token shaped alone', async () => {
      await service.revoke('not-a-token');

      expect(refreshTokens.delete).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('deletes the authorization codes and the refresh and access tokens of the account', async () => {
      await service.revokeAllForUser(7);

      expect(codes.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(refreshTokens.delete).toHaveBeenCalledWith({ userId: 7 });
      expect(revokeAllAccessTokens).toHaveBeenCalledWith(7);
    });
  });
});
