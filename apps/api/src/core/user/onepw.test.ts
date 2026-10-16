import { describe, expect, it } from 'vitest';

import { bigStretch, bundleKeys, createCredentials, stretchAuthPw, unwrapWrapKb } from '@/core/user/onepw';

const hex = (value: string) => Buffer.from(value, 'hex');

describe('server onepw', () => {
  // Mozilla vector: fxa-auth-server/lib/crypto/scrypt.spec.ts.
  it('stretches with scrypt N=65536 r=8 p=1', async () => {
    const salt = Buffer.from('identity.mozilla.com/picl/v1/scrypt').toString('hex');

    const stretched = await bigStretch('f84913e3d8e6d624689d0a3e9678ac8dcc79d2c2f3d9641488cd9d6ef6cd83dd', salt);

    expect(stretched.toString('hex')).toBe('5b82f146a64126923e4167a0350bb181feba61f63cb1714012b19cb0be0119c5');
  });

  // Mozilla vector: fxa-auth-server wiki, onepw-protocol "Test Vectors" (client stretch-KDF and /account/keys).
  it('derives verifyHash and wrapwrapKey from the stretched authPW', async () => {
    const stretched = await stretchAuthPw(
      '247b675ffb4c46310bc87e26d712153abe5e1c90ef00a4784594f97ef54f2375',
      '00f0000000000000000000000000000000000000000000000000000000000000'
    );

    expect(stretched.verifyHash).toBe('a4765bf103dc057f4cf4bc2c131ddb6716e8a4333cc55e1d3c449f31f0eec4f1');
    expect(stretched.wrapwrapKey.toString('hex')).toBe(
      '3ebea117efa9faf57ce195899b2905058368e7760cc26ea58a2a1be0da7fb287'
    );
  });

  it('wraps wrapKb so the same authPW unwraps it', async () => {
    const authPw = '247b675ffb4c46310bc87e26d712153abe5e1c90ef00a4784594f97ef54f2375';
    const wrapKb = '34937143c59b20e4c4c2c3e8679a743cb2fcbe189431fa1b23e5e8a7fa22a8c1';

    const credentials = await createCredentials(
      authPw,
      wrapKb,
      'identity.mozilla.com/picl/v1/quickStretchV2:0123456789abcdef0123456789abcdef'
    );
    const stretched = await stretchAuthPw(authPw, credentials.authSalt);

    expect(credentials.authSalt).toMatch(/^[0-9a-f]{64}$/);
    expect(credentials.verifyHash).toBe(stretched.verifyHash);
    expect(credentials.wrapWrapKb).not.toBe(wrapKb);
    expect(unwrapWrapKb(credentials.wrapWrapKb, stretched.wrapwrapKey).toString('hex')).toBe(wrapKb);
  });

  // Mozilla vector: fxa-auth-server/lib/tokens/key_fetch_token.spec.ts (keyRequestKey is that token's bundleKey).
  it('bundles kA and wrapKb for /account/keys', () => {
    const bundle = bundleKeys(
      hex('14f338a9e8c6324d9e102d4e6ee83b209796d5c74bb734a410e729e014a4a546'),
      hex('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f'),
      hex('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f')
    );

    expect(bundle).toBe(
      'ee5c58845c7c9412b11bbd20920c2fddd83c33c9cd2c2de2d66b222613364636c2c0f8cfbb7c630472c0bd88451342c6' +
        'c05b14ce342c5ad46ad89e84464c993c3927d30230157d0817a077eef4b20d976f7a97363faf3f064c003ada7d01aa70'
    );
  });
});
