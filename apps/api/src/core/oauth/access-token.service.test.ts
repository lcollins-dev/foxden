import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessToken } from '@/core/oauth/entities/access-token.entity';
import { SigningKey } from '@/core/oauth/entities/signing-key.entity';
import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import { AccessTokenService } from '@/core/oauth/access-token.service';
import { SigningKeyService } from '@/core/oauth/signing-key.service';

import { OLDSYNC_SCOPE } from '@/core/oauth/oauth-clients';

const SESSION_ID = 3;

const buildUser = (): User => {
  const user = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Tester',
    email: 'tester@example.com',
    locale: null,
    kA: '00',
    credentials: { authSalt: '00', verifyHash: '00', wrapWrapKb: '00', clientSalt: 'salt' },
    now: 1759230000000,
  });
  user.id = 7;

  return user;
};

describe('AccessTokenService', () => {
  let signingKeyRepository: { find: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
  let accessTokenRepository: {
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
  };
  let signingKeyService: SigningKeyService;
  let service: AccessTokenService;
  const user = buildUser();

  beforeEach(async () => {
    signingKeyRepository = { find: vi.fn().mockResolvedValue([]), insert: vi.fn().mockResolvedValue(undefined) };
    accessTokenRepository = {
      insert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn(),
    };

    signingKeyService = new SigningKeyService(signingKeyRepository as unknown as Repository<SigningKey>);
    await signingKeyService.onModuleInit();

    service = new AccessTokenService(
      { webAppBaseUrl: 'https://sync.example/' } as unknown as ConfigService,
      signingKeyService,
      accessTokenRepository as unknown as Repository<AccessToken>
    );
  });

  it('generates and stores a signing key on first start, then reuses the stored one', async () => {
    expect(signingKeyRepository.insert).toHaveBeenCalledTimes(1);

    const stored = signingKeyRepository.insert.mock.calls[0][0] as SigningKey;
    signingKeyRepository.find.mockResolvedValue([stored]);

    const restarted = new SigningKeyService(signingKeyRepository as unknown as Repository<SigningKey>);
    await restarted.onModuleInit();

    expect(signingKeyRepository.insert).toHaveBeenCalledTimes(1);
    expect(await restarted.getPublicJwks()).toEqual(await signingKeyService.getPublicJwks());
  });

  it('publishes only the public half of the key', async () => {
    const jwks = await signingKeyService.getPublicJwks();

    expect(jwks.keys).toHaveLength(1);
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(['alg', 'e', 'fxa-createdAt', 'kid', 'kty', 'n', 'use']);
  });

  it('mints an at+JWT with the claims syncstorage-rs reads', async () => {
    const { accessToken, expiresIn } = await service.mint(
      user,
      SESSION_ID,
      '5882386c6d801776',
      OLDSYNC_SCOPE,
      1759230000000,
      21600
    );

    const { payload, protectedHeader } = await jwtVerify(
      accessToken,
      createLocalJWKSet(await signingKeyService.getPublicJwks()),
      { typ: 'at+JWT' }
    );

    expect(expiresIn).toBe(21600);
    expect(protectedHeader).toMatchObject({ alg: 'RS256', typ: 'at+JWT' });
    expect(payload).toMatchObject({
      iss: 'https://sync.example',
      aud: 'https://sync.example/token/1.0/sync/1.5',
      sub: user.uid,
      scope: OLDSYNC_SCOPE,
      client_id: '5882386c6d801776',
      'fxa-generation': 1759230000000,
      auth_time: 1759230000,
    });
    expect(accessTokenRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ jti: payload.jti, userId: 7, sessionId: SESSION_ID, scope: OLDSYNC_SCOPE })
    );
  });

  it('caps the lifetime at 24 hours and addresses non-Sync tokens to the client', async () => {
    const { accessToken, expiresIn } = await service.mint(
      user,
      SESSION_ID,
      '5882386c6d801776',
      'profile',
      0,
      10_000_000
    );
    const { payload } = await jwtVerify(accessToken, createLocalJWKSet(await signingKeyService.getPublicJwks()));

    expect(expiresIn).toBe(86400);
    expect(payload.aud).toBe('5882386c6d801776');
  });

  it('verifies a token only while its record exists and the account is enabled', async () => {
    const { accessToken } = await service.mint(user, SESSION_ID, '5882386c6d801776', 'profile', 0);
    const record = Object.assign(accessTokenRepository.insert.mock.calls[0][0] as AccessToken, { user });

    accessTokenRepository.findOne.mockResolvedValueOnce(record);
    expect((await service.verify(accessToken))?.scopes).toEqual(['profile']);

    accessTokenRepository.findOne.mockResolvedValueOnce(null);
    expect(await service.verify(accessToken)).toBeNull();

    accessTokenRepository.findOne.mockResolvedValueOnce(
      Object.assign(new AccessToken(record), { user: Object.assign(buildUser(), { enabled: false }) })
    );
    expect(await service.verify(accessToken)).toBeNull();
  });

  it('rejects a token signed by another key or tampered with', async () => {
    const { accessToken } = await service.mint(user, SESSION_ID, '5882386c6d801776', 'profile', 0);
    const [header, payload, signature] = accessToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'x' })
    );

    expect(await service.verify(`${header}.${forged.toString('base64url')}.${signature}`)).toBeNull();
    expect(await service.verify('not-a-jwt')).toBeNull();
    expect(decodeProtectedHeader(accessToken).kid).toBe(signingKeyService.getActiveKey().kid);
  });

  it('revokes by deleting the record behind a signed token', async () => {
    const { accessToken } = await service.mint(user, SESSION_ID, '5882386c6d801776', 'profile', 0);
    const { jti } = accessTokenRepository.insert.mock.calls[0][0] as AccessToken;

    expect(await service.revoke(accessToken)).toBe(true);
    expect(accessTokenRepository.delete).toHaveBeenLastCalledWith({ jti });
    expect(await service.revoke('0'.repeat(64))).toBe(false);
  });
});
