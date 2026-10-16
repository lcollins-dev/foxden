import { CompactEncrypt, importJWK } from 'jose';

import { base64UrlDecode, base64UrlEncode, bytesToHex, utf8 } from './bytes';
import { hkdf, KW_PREFIX } from './onepw';

/** The scope whose key encrypts Sync data. */
export const OLDSYNC_SCOPE = 'https://identity.mozilla.com/apps/oldsync';

export interface IScopedKey {
  kty: 'oct';
  scope: string;
  k: string;
  /** `<keyRotationTimestamp ms>-<b64u(kXCS)>`; Firefox rejects a zero timestamp. */
  kid: string;
}

/** The keys_jwe plaintext, keyed by scope. */
export type ScopedKeys = Record<string, IScopedKey>;

const TIMESTAMP_PATTERN = /^[0-9]{13}$/;

/** kXCS = first 16 bytes of SHA-256(kB), sent to the tokenserver as X-Client-State. */
export async function deriveClientStateBytes(kB: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', kB);

  return new Uint8Array(digest).slice(0, 16);
}

export async function deriveClientState(kB: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(await deriveClientStateBytes(kB));
}

/** Legacy oldsync derivation: the rotation secret and uid are not mixed in, and the kid keeps milliseconds. */
export async function deriveOldsyncKey(kB: Uint8Array<ArrayBuffer>, keyRotationTimestamp: number): Promise<IScopedKey> {
  if (!TIMESTAMP_PATTERN.test(String(keyRotationTimestamp))) {
    throw new Error('keyRotationTimestamp must be a 13-digit millisecond timestamp');
  }

  const kSync = await hkdf(kB, `${KW_PREFIX}oldsync`, 64);
  const kXCS = await deriveClientStateBytes(kB);

  return {
    kty: 'oct',
    scope: OLDSYNC_SCOPE,
    k: base64UrlEncode(kSync),
    kid: `${keyRotationTimestamp}-${base64UrlEncode(kXCS)}`,
  };
}

function readPublicJwk(keysJwk: string): { kty: string; crv: string; x: string; y: string } {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(keysJwk)));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('kty' in parsed) ||
    !('crv' in parsed) ||
    !('x' in parsed) ||
    !('y' in parsed) ||
    parsed.kty !== 'EC' ||
    parsed.crv !== 'P-256' ||
    typeof parsed.x !== 'string' ||
    typeof parsed.y !== 'string' ||
    'd' in parsed
  ) {
    throw new Error('keys_jwk is not a P-256 public key');
  }

  return { kty: parsed.kty, crv: parsed.crv, x: parsed.x, y: parsed.y };
}

/** Encrypts to Firefox's `keys_jwk` as compact ECDH-ES/A256GCM without apu/apv, which Firefox rejects. */
export async function buildKeysJwe(keysJwk: string, scopedKeys: ScopedKeys): Promise<string> {
  const publicKey = await importJWK(readPublicJwk(keysJwk), 'ECDH-ES');

  return new CompactEncrypt(utf8(JSON.stringify(scopedKeys)))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM' })
    .encrypt(publicKey);
}
