import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthorizationDto } from './dto/authorization.dto';

import { OauthFirefoxService } from './oauth-firefox.service';
import { OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession } from '@/core/session/session.service';

import { AuthServerOauthController } from './auth-server-oauth.controller';

import { findClient, OLDSYNC_SCOPE } from '@/core/oauth/oauth-clients';

const CLIENT_ID = '5882386c6d801776';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const resolved = { session: { id: 3, userId: 7 }, user: { id: 7 } } as unknown as IResolvedSession;

describe('AuthServerOauthController', () => {
  let oauthService: Record<string, ReturnType<typeof vi.fn>>;
  let controller: AuthServerOauthController;

  beforeEach(() => {
    oauthService = {
      findClientWithThrow: vi.fn().mockReturnValue(findClient(CLIENT_ID)),
      authorize: vi.fn().mockResolvedValue({ code: 'c', redirect: 'urn:redirect', scope: OLDSYNC_SCOPE }),
      scopedKeys: vi.fn().mockReturnValue([]),
    };

    controller = new AuthServerOauthController({} as OauthFirefoxService, oauthService as unknown as OauthService);
  });

  describe('scopedKeyData', () => {
    it('keys each scoped key by its identifier', () => {
      oauthService.scopedKeys.mockReturnValue([
        { identifier: OLDSYNC_SCOPE, keyRotationSecret: '0'.repeat(64), keyRotationTimestamp: 1759230000123 },
      ]);

      expect(controller.scopedKeyData(resolved, { client_id: CLIENT_ID, scope: OLDSYNC_SCOPE })).toEqual({
        [OLDSYNC_SCOPE]: {
          identifier: OLDSYNC_SCOPE,
          keyRotationSecret: '0'.repeat(64),
          keyRotationTimestamp: 1759230000123,
        },
      });
    });
  });

  describe('authorize', () => {
    const request = (fields: Partial<AuthorizationDto> = {}): AuthorizationDto => ({
      client_id: CLIENT_ID,
      state: 'state',
      scope: `${OLDSYNC_SCOPE} profile`,
      access_type: 'offline',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      keys_jwe: 'header..iv.ciphertext.tag',
      ...fields,
    });

    it('hands the request to core and answers with the state it was sent', async () => {
      await expect(controller.authorize(resolved, request())).resolves.toEqual({
        code: 'c',
        state: 'state',
        redirect: 'urn:redirect',
        scope: OLDSYNC_SCOPE,
      });

      expect(oauthService.authorize).toHaveBeenCalledWith(resolved, findClient(CLIENT_ID), {
        state: 'state',
        scope: `${OLDSYNC_SCOPE} profile`,
        codeChallenge: CHALLENGE,
        keysJwe: 'header..iv.ciphertext.tag',
        offline: true,
      });
    });

    it('requires PKCE (169), a code response type (168) and the registered redirect (167)', async () => {
      await expect(controller.authorize(resolved, request({ code_challenge: undefined }))).rejects.toMatchObject({
        body: { errno: 169 },
      });
      await expect(controller.authorize(resolved, request({ response_type: 'token' }))).rejects.toMatchObject({
        body: { errno: 168 },
      });
      await expect(
        controller.authorize(resolved, request({ redirect_uri: 'https://evil.example' }))
      ).rejects.toMatchObject({ body: { errno: 167 } });

      expect(oauthService.authorize).not.toHaveBeenCalled();
    });
  });
});
