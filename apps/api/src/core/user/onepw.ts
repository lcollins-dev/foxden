import { createHmac, hkdfSync, scrypt, timingSafeEqual } from 'node:crypto';

import { IOnepwCredentials } from '@/core/user/entities/user.entity';

import { randomHex } from '@/common/secret-token';

// Server side of onepw (fxa-auth-server/lib/crypto/password.js, scrypt.js, lib/tokens/key_fetch_token.js).

const KW_PREFIX = 'identity.mozilla.com/picl/v1/';

const SCRYPT_OPTIONS = { N: 65536, r: 8, p: 1, maxmem: 256 * 65536 * 8 };

const hkdf = (ikm: Buffer, info: string, length: number): Buffer =>
  Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(32), `${KW_PREFIX}${info}`, length));

const xor = (left: Buffer, right: Buffer): Buffer => Buffer.from(left.map((byte, i) => byte ^ right[i]));

const scryptAsync = (password: Buffer, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_OPTIONS, (error, derived) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });

export interface IStretchedAuthPw {
  verifyHash: string;
  wrapwrapKey: Buffer;
}

/** bigStretchedPW = scrypt(authPW, authSalt, N=65536, r=8, p=1, 32 bytes). */
export function bigStretch(authPwHex: string, authSaltHex: string): Promise<Buffer> {
  return scryptAsync(Buffer.from(authPwHex, 'hex'), Buffer.from(authSaltHex, 'hex'));
}

export async function stretchAuthPw(authPwHex: string, authSaltHex: string): Promise<IStretchedAuthPw> {
  const bigStretchedPw = await bigStretch(authPwHex, authSaltHex);

  return {
    verifyHash: hkdf(bigStretchedPw, 'verifyHash', 32).toString('hex'),
    wrapwrapKey: hkdf(bigStretchedPw, 'wrapwrapKey', 32),
  };
}

/** The stretched authPW when it matches the stored verifier, else null. */
export async function checkAuthPw(
  authPwHex: string,
  credentials: Pick<IOnepwCredentials, 'authSalt' | 'verifyHash'>
): Promise<IStretchedAuthPw | null> {
  const stretched = await stretchAuthPw(authPwHex, credentials.authSalt);
  const matches = timingSafeEqual(Buffer.from(stretched.verifyHash, 'hex'), Buffer.from(credentials.verifyHash, 'hex'));

  return matches ? stretched : null;
}

/** Credentials for a new v2 account: a fresh authSalt, the verifier and wrapKb wrapped once more. */
export async function createCredentials(
  authPwHex: string,
  wrapKbHex: string,
  clientSalt: string
): Promise<IOnepwCredentials> {
  const authSalt = randomHex(32);
  const stretched = await stretchAuthPw(authPwHex, authSalt);

  return {
    authSalt,
    verifyHash: stretched.verifyHash,
    wrapWrapKb: xor(Buffer.from(wrapKbHex, 'hex'), stretched.wrapwrapKey).toString('hex'),
    clientSalt,
  };
}

/** wrapKb = wrapWrapKb XOR wrapwrapKey; the unwrap and the wrap are the same XOR. */
export function unwrapWrapKb(wrapWrapKbHex: string, wrapwrapKey: Buffer): Buffer {
  return xor(Buffer.from(wrapWrapKbHex, 'hex'), wrapwrapKey);
}

/** The `/account/keys` bundle: (kA || wrapKb) encrypted and MACed under keys from keyRequestKey. */
export function bundleKeys(keyRequestKey: Buffer, kA: Buffer, wrapKb: Buffer): string {
  const responseKeys = hkdf(keyRequestKey, 'account/keys', 96);

  const ciphertext = xor(Buffer.concat([kA, wrapKb]), responseKeys.subarray(32, 96));
  const mac = createHmac('sha256', responseKeys.subarray(0, 32)).update(ciphertext).digest();

  return Buffer.concat([ciphertext, mac]).toString('hex');
}
