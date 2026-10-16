import { describe, expect, it } from 'vitest';

import { bytesToHex, hexToBytes, xorBytes } from './bytes';
import {
  createClientSalt,
  createPasswordCredentials,
  createSignUpKeys,
  deriveTokenKeys,
  isClientSalt,
  keyFetchTokenBearer,
  sessionTokenBearer,
  stretchPasswordV1,
  stretchPasswordV2,
  unbundleKeyFetchResponse,
  unwrapKb,
} from './onepw';
import { codeChallengeS256 } from './pkce';

// Mozilla vectors: ff/services/fxaccounts/tests/xpcshell/test_credentials.js (onepw wiki "client stretch-KDF").
describe('stretchPasswordV1', () => {
  it('matches the onepw wiki vector for andré@example.org', async () => {
    const stretched = await stretchPasswordV1('andré@example.org', 'pässwörd');

    expect(bytesToHex(stretched.quickStretchedPW)).toBe(
      'e4e8889bd8bd61ad6de6b95c059d56e7b50dacdaf62bd84644af7e2add84345d'
    );
    expect(bytesToHex(stretched.authPW)).toBe('247b675ffb4c46310bc87e26d712153abe5e1c90ef00a4784594f97ef54f2375');
    expect(bytesToHex(stretched.unwrapBKey)).toBe('de6a2648b78284fcb9ffa81ba95803309cfba7af583c01a8a1a63e567234dd28');
  });

  it('matches the test_credentials.js vector for francine@example.org', async () => {
    const stretched = await stretchPasswordV1('francine@example.org', 'i like pie');

    expect(bytesToHex(stretched.quickStretchedPW)).toBe(
      '6b88094c1c73bbf133223f300d101ed70837af48d9d2c1b6e7d38804b20cdde4'
    );
    expect(bytesToHex(stretched.authPW)).toBe('4b8dec7f48e7852658163601ff766124c312f9392af6c3d4e1a247eb439be342');
    expect(bytesToHex(stretched.unwrapBKey)).toBe('8ff58975be391338e4ec5d7138b5ed7b65c7d1bfd1f3a4f93e05aa47d5b72be9');
  });
});

// Mozilla publishes no v2 vector; this one is computed independently with node:crypto. v2 shares every step after
// PBKDF2 with v1, which the vectors above pin.
describe('stretchPasswordV2', () => {
  it('matches the node:crypto reference vector', async () => {
    const stretched = await stretchPasswordV2(
      'pässwörd',
      'identity.mozilla.com/picl/v1/quickStretchV2:0123456789abcdef0123456789abcdef'
    );

    expect(bytesToHex(stretched.quickStretchedPW)).toBe(
      '1962d132874d2be60129f21229c42205e75661b08b7e657c4997972475459e41'
    );
    expect(bytesToHex(stretched.authPW)).toBe('d278c764bd1852a14bfc4e9d8c1682b4f1a57edb9a9372bf8c370cc41592155b');
    expect(bytesToHex(stretched.unwrapBKey)).toBe('616616095eff30032abf6a47df30d9a3fc799d8af5e8519905c1601170553493');
  });

  it('rejects a salt that is not a v2 client salt', async () => {
    await expect(
      stretchPasswordV2('pässwörd', 'identity.mozilla.com/picl/v1/quickStretch:a@example.com')
    ).rejects.toThrow('Invalid client salt');
  });
});

describe('createClientSalt', () => {
  it('creates a distinct valid salt each time', () => {
    const first = createClientSalt();

    expect(isClientSalt(first)).toBe(true);
    expect(createClientSalt()).not.toBe(first);
  });
});

describe('createPasswordCredentials', () => {
  it('stretches the password under a fresh client salt', async () => {
    const credentials = await createPasswordCredentials('pässwörd');

    expect(isClientSalt(credentials.clientSalt)).toBe(true);
    expect(credentials.authPw).toBe(bytesToHex((await stretchPasswordV2('pässwörd', credentials.clientSalt)).authPW));
    expect((await createPasswordCredentials('pässwörd')).clientSalt).not.toBe(credentials.clientSalt);
  }, 30_000);
});

describe('createSignUpKeys and unwrapKb', () => {
  it('wraps kB so unwrapBKey recovers it', () => {
    const unwrapBKey = hexToBytes('de6a2648b78284fcb9ffa81ba95803309cfba7af583c01a8a1a63e567234dd28');

    const { kB, wrapKb } = createSignUpKeys(unwrapBKey);

    expect(bytesToHex(unwrapKb(wrapKb, unwrapBKey))).toBe(bytesToHex(kB));
  });
});

// Mozilla vectors: fxa-auth-server/lib/tokens/session_token.spec.ts and key_fetch_token.spec.ts.
describe('deriveTokenKeys', () => {
  it('matches the session token vector', async () => {
    const keys = await deriveTokenKeys(
      'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
      'sessionToken'
    );

    expect(keys.tokenId).toBe('c0a29dcf46174973da1378696e4c82ae10f723cf4f4d9f75e39f4ae3851595ab');
    expect(bytesToHex(keys.reqHMACkey)).toBe('9d8f22998ee7f5798b887042466b72d53e56ab0c094388bf65831f702d2febc0');
  });

  it('matches the keyFetchToken vector', async () => {
    const keys = await deriveTokenKeys(
      '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
      'keyFetchToken'
    );

    expect(keys.tokenId).toBe('3d0a7c02a15a62a2882f76e39b6494b500c022a8816e048625a495718998ba60');
    expect(bytesToHex(keys.reqHMACkey)).toBe('87b8937f61d38d0e29cd2d5600b3f4da0aa48ac41de36a0efe84bb4a9872ceb7');
    expect(bytesToHex(keys.extraKey)).toBe('14f338a9e8c6324d9e102d4e6ee83b209796d5c74bb734a410e729e014a4a546');
  });

  it('builds the Bearer headers from the derived ids', async () => {
    expect(await sessionTokenBearer('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf')).toBe(
      'Bearer fxs_c0a29dcf46174973da1378696e4c82ae10f723cf4f4d9f75e39f4ae3851595ab'
    );
    expect(await keyFetchTokenBearer('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f')).toBe(
      'Bearer fxk_3d0a7c02a15a62a2882f76e39b6494b500c022a8816e048625a495718998ba60'
    );
  });
});

describe('unbundleKeyFetchResponse', () => {
  const keyFetchToken = '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f';

  // key_fetch_token.spec.ts: bundleKeys(kA, wrapKb) for this token.
  const bundle =
    'ee5c58845c7c9412b11bbd20920c2fddd83c33c9cd2c2de2d66b222613364636c2c0f8cfbb7c630472c0bd88451342c6' +
    'c05b14ce342c5ad46ad89e84464c993c3927d30230157d0817a077eef4b20d976f7a97363faf3f064c003ada7d01aa70';

  it('recovers kA and wrapKb from the Mozilla bundle vector', async () => {
    const keys = await unbundleKeyFetchResponse(keyFetchToken, bundle);

    expect(bytesToHex(keys.kA)).toBe('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f');
    expect(bytesToHex(keys.wrapKb)).toBe('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f');
  });

  it('rejects a bundle whose MAC does not match', async () => {
    const tampered = bytesToHex(xorBytes(hexToBytes(bundle), new Uint8Array(96).fill(1)));

    await expect(unbundleKeyFetchResponse(keyFetchToken, tampered)).rejects.toThrow('Key bundle MAC mismatch');
  });
});

// RFC 7636 appendix B.
describe('codeChallengeS256', () => {
  it('matches the RFC 7636 vector', async () => {
    expect(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});
