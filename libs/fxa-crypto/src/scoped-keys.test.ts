import { describe, expect, it } from 'vitest';

import { base64UrlDecode, base64UrlEncode, hexToBytes, utf8 } from './bytes';
import { buildKeysJwe, deriveClientState, deriveOldsyncKey, OLDSYNC_SCOPE } from './scoped-keys';

const KB = hexToBytes('eaf9570b7219a4187d3d6bf3cec2770c2e0719b7cc0dfbb38243d6f1881675e9');

// Mozilla vectors: ff/services/fxaccounts/tests/xpcshell/test_keys.js and
// fxa/libs/vendored/crypto-relier/src/lib/deriver/scoped-keys.spec.ts ("legacy sync key").
describe('deriveOldsyncKey', () => {
  it('matches the legacy Sync key vector', async () => {
    const key = await deriveOldsyncKey(KB, 1510726317123);

    expect(key).toEqual({
      kty: 'oct',
      scope: OLDSYNC_SCOPE,
      k: 'DW_ll5GwX6SJ5GPqJVAuMUP2t6kDqhUulc2cbt26xbTcaKGQl-9l29FHAQ7kUiJETma4s9fIpEHrt909zgFang',
      kid: '1510726317123-IqQv4onc7VcVE1kTQkyyOw',
    });
  });

  it('rejects a timestamp that is not 13 digits, as Firefox rejects a zero kid', async () => {
    await expect(deriveOldsyncKey(KB, 0)).rejects.toThrow('13-digit');
    await expect(deriveOldsyncKey(KB, 1510726317)).rejects.toThrow('13-digit');
  });
});

describe('deriveClientState', () => {
  it('is the first 16 bytes of SHA-256(kB) in hex', async () => {
    expect(await deriveClientState(KB)).toBe('22a42fe289dced5715135913424cb23b');
  });
});

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

/** Port of Firefox's JWCrypto.decryptJWE (ff/services/crypto/modules/jwcrypto.sys.mjs), checks included. */
async function firefoxDecryptJwe(jwe: string, privateKey: CryptoKey): Promise<string> {
  const [headerSegment, cek, iv, ciphertext, tag] = jwe.split('.');
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerSegment))) as Record<string, unknown>;

  if (cek.length > 0 || header.enc !== 'A256GCM' || header.alg !== 'ECDH-ES') {
    throw new Error('Unknown algorithm.');
  }

  if ('apu' in header || 'apv' in header) {
    throw new Error('apu and apv header values are not supported.');
  }

  const peerPublicKey = await crypto.subtle.importKey('jwk', header.epk as JsonWebKey, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256)
  );

  // Concat KDF (RFC 7518 4.6) for enc A256GCM, empty PartyUInfo and PartyVInfo, 256-bit key.
  const uint32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const concatKdfInput = new Uint8Array([
    ...uint32(1),
    ...shared,
    ...uint32(7),
    ...utf8('A256GCM'),
    ...uint32(0),
    ...uint32(0),
    ...uint32(256),
  ]);
  const contentKeyBytes = await crypto.subtle.digest('SHA-256', concatKdfInput);
  const contentKey = await crypto.subtle.importKey('raw', contentKeyBytes, 'AES-GCM', false, ['decrypt']);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(iv), tagLength: 128, additionalData: utf8(headerSegment) },
    contentKey,
    new Uint8Array([...base64UrlDecode(ciphertext), ...base64UrlDecode(tag)])
  );

  return new TextDecoder().decode(plaintext);
}

describe('buildKeysJwe', () => {
  it('produces a JWE that Firefox decrypts to the scoped keys', async () => {
    const keyPair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);

    // Firefox sends WebCrypto's export, ext and key_ops included.
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const keysJwk = base64UrlEncode(utf8(JSON.stringify(publicJwk)));

    const scopedKeys = { [OLDSYNC_SCOPE]: await deriveOldsyncKey(KB, 1510726317123) };
    const jwe = await buildKeysJwe(keysJwk, scopedKeys);

    expect(jwe).toMatch(/^[A-Za-z0-9-_]+\.\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    expect(JSON.parse(await firefoxDecryptJwe(jwe, keyPair.privateKey))).toEqual(scopedKeys);
  });

  it('rejects a keys_jwk that is not a P-256 public key', async () => {
    const privateJwk = base64UrlEncode(utf8(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'c' })));

    await expect(buildKeysJwe(privateJwk, {})).rejects.toThrow('keys_jwk is not a P-256 public key');
  });
});
