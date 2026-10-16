import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OauthFirefoxService } from './oauth-firefox.service';
import { IGrantedTokens, OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';

import { OLDSYNC_SCOPE } from '@/core/oauth/oauth-clients';

const CLIENT_ID = '5882386c6d801776';
const client = { id: CLIENT_ID };
const resolved = { session: { id: 3 }, user: { id: 7 } } as unknown as IResolvedSession;

const granted = (fields: Partial<IGrantedTokens> = {}): IGrantedTokens => ({
  accessToken: 'jwt',
  expiresIn: 86400,
  scope: OLDSYNC_SCOPE,
  authAt: 1759230000999,
  refreshToken: null,
  keysJwe: null,
  ...fields,
});

describe('OauthFirefoxService', () => {
  let oauthService: Record<string, ReturnType<typeof vi.fn>>;
  let resolve: ReturnType<typeof vi.fn>;
  let service: OauthFirefoxService;

  beforeEach(() => {
    oauthService = {
      findClientWithThrow: vi.fn().mockReturnValue(client),
      grantAuthorizationCode: vi.fn().mockResolvedValue(granted()),
      grantFxaCredentials: vi.fn().mockResolvedValue(granted()),
      grantRefreshToken: vi.fn().mockResolvedValue(granted()),
      revoke: vi.fn(),
    };
    resolve = vi.fn().mockResolvedValue(resolved);

    service = new OauthFirefoxService(
      oauthService as unknown as OauthService,
      { resolve } as unknown as SessionService
    );
  });

  describe('token', () => {
    it('answers in Mozilla`s shape, auth_at in seconds, refresh token before keys_jwe', async () => {
      oauthService.grantAuthorizationCode.mockResolvedValue(
        granted({ refreshToken: 'r'.repeat(64), keysJwe: 'header..iv.ciphertext.tag' })
      );

      const response = await service.token(
        { grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'a', code_verifier: 'v' },
        undefined
      );

      expect(oauthService.grantAuthorizationCode).toHaveBeenCalledWith(client, 'a', 'v', undefined);
      expect(Object.entries(response)).toEqual([
        ['access_token', 'jwt'],
        ['token_type', 'bearer'],
        ['scope', OLDSYNC_SCOPE],
        ['expires_in', 86400],
        ['auth_at', 1759230000],
        ['refresh_token', 'r'.repeat(64)],
        ['keys_jwe', 'header..iv.ciphertext.tag'],
      ]);
    });

    it('leaves the refresh token and keys_jwe out when none were granted', async () => {
      const response = await service.token(
        { grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'b'.repeat(64) },
        undefined
      );

      expect(response).not.toHaveProperty('refresh_token');
      expect(response).not.toHaveProperty('keys_jwe');
    });

    it('checks the client before anything the grant needs', async () => {
      oauthService.findClientWithThrow.mockImplementation(() => {
        throw new Error('unknown client');
      });

      await expect(
        service.token({ grant_type: 'authorization_code', client_id: CLIENT_ID }, undefined)
      ).rejects.toThrow('unknown client');
    });

    it('needs a code (108) and a verifier (169) for authorization_code', async () => {
      await expect(
        service.token({ grant_type: 'authorization_code', client_id: CLIENT_ID }, undefined)
      ).rejects.toMatchObject({ body: { errno: 108, param: 'code' } });

      await expect(
        service.token({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'a' }, undefined)
      ).rejects.toMatchObject({ body: { errno: 169 } });
    });

    it('resolves the session for fxa-credentials, needing one (110) and a scope (108)', async () => {
      await service.token(
        {
          grant_type: 'fxa-credentials',
          client_id: CLIENT_ID,
          scope: OLDSYNC_SCOPE,
          ttl: 21600,
          access_type: 'offline',
        },
        'Bearer fxs_x'
      );

      expect(resolve).toHaveBeenCalledWith('Bearer fxs_x');
      expect(oauthService.grantFxaCredentials).toHaveBeenCalledWith(client, resolved, OLDSYNC_SCOPE, 21600, true);

      resolve.mockResolvedValueOnce(null);
      await expect(
        service.token({ grant_type: 'fxa-credentials', client_id: CLIENT_ID, scope: 'profile' }, undefined)
      ).rejects.toMatchObject({ body: { errno: 110 } });

      await expect(
        service.token({ grant_type: 'fxa-credentials', client_id: CLIENT_ID }, 'Bearer fxs_x')
      ).rejects.toMatchObject({ body: { errno: 108, param: 'scope' } });
    });

    it('needs a refresh token (108) for refresh_token', async () => {
      await expect(
        service.token({ grant_type: 'refresh_token', client_id: CLIENT_ID }, undefined)
      ).rejects.toMatchObject({ body: { errno: 108, param: 'refresh_token' } });
    });
  });

  describe('destroy', () => {
    it('answers {} with or without a token, revoking whichever field carries it', async () => {
      expect(await service.destroy({})).toEqual({});
      expect(oauthService.revoke).not.toHaveBeenCalled();

      expect(await service.destroy({ client_id: CLIENT_ID, refresh_token: 'C'.repeat(64) })).toEqual({});
      expect(oauthService.revoke).toHaveBeenCalledWith('C'.repeat(64));
    });
  });
});
