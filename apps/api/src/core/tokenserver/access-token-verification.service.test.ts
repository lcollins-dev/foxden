import { exportJWK, generateKeyPair, JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AccessTokenVerificationService, SYNC_SCOPE } from './access-token-verification.service';
import { AccessTokenService } from '@/core/oauth/access-token.service';
import { SigningKeyService } from '@/core/oauth/signing-key.service';

import { TokenserverRefusedError } from './tokenserver-refusal';

interface IKey {
  privateKey: CryptoKey;
  jwk: JWK;
}

const makeKey = async (kid: string): Promise<IKey> => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });

  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
};

const jwksOf = (...keys: IKey[]): SigningKeyService =>
  ({ getPublicJwks: () => Promise.resolve({ keys: keys.map(key => key.jwk) }) }) as unknown as SigningKeyService;

const JTI = 'f'.repeat(64);

const recorded = { isRecorded: () => Promise.resolve(true) } as unknown as AccessTokenService;

const sign = (
  key: IKey,
  claims: Record<string, unknown>,
  header: { typ?: string; kid?: string } = {},
  expiresIn = 3600
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ sub: 'abc123', scope: SYNC_SCOPE, jti: JTI, ...claims })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+JWT', kid: key.jwk.kid, ...header })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(key.privateKey);
};

const failureOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TokenserverRefusedError) {
      return error.refusal.reason;
    }

    throw error;
  }

  return 'ok';
};

describe('AccessTokenVerificationService', () => {
  let current: IKey;
  let previous: IKey;

  beforeAll(async () => {
    current = await makeKey('current');
    previous = await makeKey('previous');
  });

  it('reads the FxA uid and generation from a valid token', async () => {
    const verifier = new AccessTokenVerificationService(jwksOf(current), recorded);

    await expect(verifier.verify(await sign(current, { 'fxa-generation': 1700 }))).resolves.toEqual({
      fxaUid: 'abc123',
      generation: 1700,
    });
    await expect(verifier.verify(await sign(current, { 'fxa-generation': 0 }))).resolves.toMatchObject({
      generation: null,
    });
  });

  it('tries each key, so a token signed with an older key still verifies', async () => {
    const verifier = new AccessTokenVerificationService(jwksOf(current, previous), recorded);

    await expect(verifier.verify(await sign(previous, {}, { kid: undefined }))).resolves.toMatchObject({
      fxaUid: 'abc123',
    });
  });

  it('normalises typ: at+JWT, application/at+jwt and case variants pass', async () => {
    const verifier = new AccessTokenVerificationService(jwksOf(current), recorded);

    for (const typ of ['at+JWT', 'application/at+jwt', 'AT+jwt']) {
      expect(await failureOf(verifier.verify(await sign(current, {}, { typ })))).toBe('ok');
    }
  });

  it.each<[string, (key: IKey) => Promise<string>]>([
    ['an expired token', key => sign(key, {}, {}, -120)],
    ['a plain JWT typ', key => sign(key, {}, { typ: 'JWT' })],
    ['a missing oldsync scope', key => sign(key, { scope: 'profile' })],
    ['a missing subject', key => sign(key, { sub: undefined })],
    ['a non-integer generation', key => sign(key, { 'fxa-generation': 'soon' })],
    ['a missing jti', key => sign(key, { jti: undefined })],
    ['an opaque token', () => Promise.resolve('a'.repeat(64))],
  ])('refuses %s as invalid-credentials', async (_case, token) => {
    const verifier = new AccessTokenVerificationService(jwksOf(current), recorded);

    expect(await failureOf(verifier.verify(await token(current)))).toBe('invalid-credentials');
  });

  it('rejects a token signed by a key it does not know', async () => {
    const stranger = await makeKey('current');

    expect(
      await failureOf(new AccessTokenVerificationService(jwksOf(current), recorded).verify(await sign(stranger, {})))
    ).toBe('invalid-credentials');
  });

  it('accepts the scope among others, split by spaces or commas', async () => {
    const verifier = new AccessTokenVerificationService(jwksOf(current), recorded);

    for (const scope of [`profile ${SYNC_SCOPE}`, `profile,${SYNC_SCOPE}`]) {
      expect(await failureOf(verifier.verify(await sign(current, { scope })))).toBe('ok');
    }
  });

  it('refuses a validly signed token whose record is gone, as a revoked one', async () => {
    const isRecorded = vi.fn().mockResolvedValue(false);
    const verifier = new AccessTokenVerificationService(jwksOf(current), {
      isRecorded,
    } as unknown as AccessTokenService);

    expect(await failureOf(verifier.verify(await sign(current, {})))).toBe('invalid-credentials');
    expect(isRecorded).toHaveBeenCalledWith(JTI, 'abc123');
  });

  it('refuses as unavailable when the record cannot be read', async () => {
    const failing = { isRecorded: () => Promise.reject(new Error('busy')) } as unknown as AccessTokenService;

    expect(
      await failureOf(new AccessTokenVerificationService(jwksOf(current), failing).verify(await sign(current, {})))
    ).toBe('unavailable');
  });

  it('refuses as unavailable when the keys cannot be read', async () => {
    const token = await sign(current, {});
    const failing = { getPublicJwks: () => Promise.reject(new Error('down')) } as unknown as SigningKeyService;

    expect(await failureOf(new AccessTokenVerificationService(failing, recorded).verify(token))).toBe('unavailable');
  });
});
