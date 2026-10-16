import { bytesToHex, hexToBytes, randomBytes, utf8, xorBytes } from './bytes';

const subtle = () => globalThis.crypto.subtle;

/** Prefix of every onepw key-wrapping info string and salt. */
export const KW_PREFIX = 'identity.mozilla.com/picl/v1/';

/** Prefix of a v2 client salt; 32 random hex characters follow it. */
export const CLIENT_SALT_PREFIX = `${KW_PREFIX}quickStretchV2:`;

/** PBKDF2 iterations for v2 key stretching. */
export const V2_ITERATIONS = 650000;

const V1_ITERATIONS = 1000;

export type TokenType = 'sessionToken' | 'keyFetchToken' | 'passwordChangeToken';

export interface IStretchedPassword {
  quickStretchedPW: Uint8Array<ArrayBuffer>;
  authPW: Uint8Array<ArrayBuffer>;
  /** Never leaves the client. */
  unwrapBKey: Uint8Array<ArrayBuffer>;
}

export interface ITokenKeys {
  tokenId: string;
  reqHMACkey: Uint8Array<ArrayBuffer>;
  /** keyRequestKey for a keyFetchToken, unused for a sessionToken. */
  extraKey: Uint8Array<ArrayBuffer>;
}

export interface ISignUpKeys {
  kB: Uint8Array<ArrayBuffer>;
  wrapKb: Uint8Array<ArrayBuffer>;
}

export interface IKeyBundle {
  kA: Uint8Array<ArrayBuffer>;
  wrapKb: Uint8Array<ArrayBuffer>;
}

/** HKDF-SHA256 with an empty salt, as every onepw derivation uses. */
export async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  info: string,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    key,
    length * 8
  );

  return new Uint8Array(bits);
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8(salt), iterations }, key, 256);

  return new Uint8Array(bits);
}

export async function deriveFromStretchedPassword(
  quickStretchedPW: Uint8Array<ArrayBuffer>
): Promise<IStretchedPassword> {
  return {
    quickStretchedPW,
    authPW: await hkdf(quickStretchedPW, `${KW_PREFIX}authPW`, 32),
    unwrapBKey: await hkdf(quickStretchedPW, `${KW_PREFIX}unwrapBkey`, 32),
  };
}

/** v1 stretching, salted with the email exactly as the account was created. */
export async function stretchPasswordV1(email: string, password: string): Promise<IStretchedPassword> {
  return deriveFromStretchedPassword(await pbkdf2(password, `${KW_PREFIX}quickStretch:${email}`, V1_ITERATIONS));
}

/** v2 stretching, salted with the account's clientSalt. */
export async function stretchPasswordV2(password: string, clientSalt: string): Promise<IStretchedPassword> {
  if (!isClientSalt(clientSalt)) {
    throw new Error('Invalid client salt');
  }

  return deriveFromStretchedPassword(await pbkdf2(password, clientSalt, V2_ITERATIONS));
}

export function createClientSalt(): string {
  return `${CLIENT_SALT_PREFIX}${bytesToHex(randomBytes(16))}`;
}

/**
 * A fresh client salt and the v2 authPW for a new password, as a reset without a recovery key sends: no wrapKb, since
 * the server makes a new kB.
 */
export async function createPasswordCredentials(password: string): Promise<{ authPw: string; clientSalt: string }> {
  const clientSalt = createClientSalt();
  const { authPW } = await stretchPasswordV2(password, clientSalt);

  return { authPw: bytesToHex(authPW), clientSalt };
}

/** Checks the shape Mozilla's auth server accepts for a v2 client salt. */
export function isClientSalt(value: string): boolean {
  return value.startsWith(CLIENT_SALT_PREFIX) && /^[0-9a-f]{32}$/.test(value.slice(CLIENT_SALT_PREFIX.length));
}

/** Picks a random kB and wraps it with unwrapBKey for account creation. */
export function createSignUpKeys(unwrapBKey: Uint8Array<ArrayBuffer>): ISignUpKeys {
  const kB = randomBytes(32);

  return { kB, wrapKb: xorBytes(kB, unwrapBKey) };
}

/** kB = wrapKb XOR unwrapBKey. */
export function unwrapKb(
  wrapKb: Uint8Array<ArrayBuffer>,
  unwrapBKey: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return xorBytes(wrapKb, unwrapBKey);
}

export async function deriveTokenKeys(tokenHex: string, tokenType: TokenType): Promise<ITokenKeys> {
  const derived = await hkdf(hexToBytes(tokenHex), `${KW_PREFIX}${tokenType}`, 96);

  return {
    tokenId: bytesToHex(derived.slice(0, 32)),
    reqHMACkey: derived.slice(32, 64),
    extraKey: derived.slice(64, 96),
  };
}

/** Builds the `Authorization` header value that authenticates with a session token seed. */
export async function sessionTokenBearer(sessionTokenHex: string): Promise<string> {
  const { tokenId } = await deriveTokenKeys(sessionTokenHex, 'sessionToken');

  return `Bearer fxs_${tokenId}`;
}

/** Builds the `Authorization` header value that authenticates with a keyFetchToken seed. */
export async function keyFetchTokenBearer(keyFetchTokenHex: string): Promise<string> {
  const { tokenId } = await deriveTokenKeys(keyFetchTokenHex, 'keyFetchToken');

  return `Bearer fxk_${tokenId}`;
}

/** Builds the `Authorization` header value that authenticates with a passwordChangeToken seed. */
export async function passwordChangeTokenBearer(passwordChangeTokenHex: string): Promise<string> {
  const { tokenId } = await deriveTokenKeys(passwordChangeTokenHex, 'passwordChangeToken');

  return `Bearer fxpc_${tokenId}`;
}

/** Verifies and decrypts the `/account/keys` bundle, throwing if its MAC does not match. */
export async function unbundleKeyFetchResponse(keyFetchTokenHex: string, bundleHex: string): Promise<IKeyBundle> {
  const bundle = hexToBytes(bundleHex);

  if (bundle.length !== 96) {
    throw new Error('Invalid key bundle length');
  }

  const { extraKey: keyRequestKey } = await deriveTokenKeys(keyFetchTokenHex, 'keyFetchToken');
  const responseKeys = await hkdf(keyRequestKey, `${KW_PREFIX}account/keys`, 96);

  const macKey = await subtle().importKey('raw', responseKeys.slice(0, 32), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ]);

  const ciphertext = bundle.slice(0, 64);

  if (!(await subtle().verify('HMAC', macKey, bundle.slice(64), ciphertext))) {
    throw new Error('Key bundle MAC mismatch');
  }

  const plaintext = xorBytes(ciphertext, responseKeys.slice(32, 96));

  return { kA: plaintext.slice(0, 32), wrapKb: plaintext.slice(32, 64) };
}
