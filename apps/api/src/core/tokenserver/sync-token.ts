import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Mozilla's tokenlib (syncstorage-rs tokenserver-auth/src/token/native.rs), so tokens interoperate with its tools.
const HKDF_SIGNING_INFO = 'services.mozilla.com/tokenlib/v1/signing';
const HKDF_DERIVE_INFO = 'services.mozilla.com/tokenlib/v1/derive/';

const SECRET_BYTES = 32;
const SIGNATURE_BYTES = 32;
const SALT_BYTES = 3;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

/** The token plaintext, in the key order syncstorage-rs serialises it. */
export interface ISyncTokenPlaintext {
  node: string;
  fxa_kid: string;
  fxa_uid: string;
  hashed_device_id: string;
  hashed_fxa_uid: string;
  expires: number;
  uid: number;
  tokenserver_origin: string;
}

export interface ISyncTokenPayload {
  uid: number;
  expires: number;
  node: string;
  salt: string;
}

export interface ISyncToken {
  id: string;
  key: string;
}

const hkdf = (secret: string, salt: string, info: string): Buffer =>
  Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(salt, 'utf8'), info, SECRET_BYTES));

/** Standard base64 with the URL-safe alphabet, padding kept, as Python's `urlsafe_b64encode`. */
const base64UrlPadded = (bytes: Buffer): string => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

export const deriveSigningSecret = (masterSecret: string): Buffer => hkdf(masterSecret, '', HKDF_SIGNING_INFO);

/** The Hawk key for a token. Both sides use the ASCII of this string as the HMAC key, never its decoded bytes. */
export const deriveTokenKey = (masterSecret: string, salt: string, id: string): string =>
  base64UrlPadded(hkdf(masterSecret, salt, `${HKDF_DERIVE_INFO}${id}`));

export function makeToken(
  plaintext: ISyncTokenPlaintext,
  masterSecret: string,
  salt: string = randomBytes(SALT_BYTES).toString('hex')
): ISyncToken {
  const json = Buffer.from(JSON.stringify({ ...plaintext, salt }), 'utf8');
  const signature = createHmac('sha256', deriveSigningSecret(masterSecret)).update(json).digest();
  const id = base64UrlPadded(Buffer.concat([json, signature]));

  return { id, key: deriveTokenKey(masterSecret, salt, id) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The payload of a token this server signed, or `null` for anything else. Expiry is the caller's to check. */
export function parseToken(id: string, signingSecret: Buffer): ISyncTokenPayload | null {
  if (!BASE64URL_PATTERN.test(id)) {
    return null;
  }

  const decoded = Buffer.from(id, 'base64url');

  if (decoded.length <= SIGNATURE_BYTES) {
    return null;
  }

  const json = decoded.subarray(0, decoded.length - SIGNATURE_BYTES);
  const signature = decoded.subarray(decoded.length - SIGNATURE_BYTES);
  const expected = createHmac('sha256', signingSecret).update(json).digest();

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(json.toString('utf8'));
  } catch {
    return null;
  }

  if (
    !isRecord(payload) ||
    typeof payload.uid !== 'number' ||
    !Number.isSafeInteger(payload.uid) ||
    payload.uid < 0 ||
    typeof payload.expires !== 'number' ||
    !Number.isFinite(payload.expires) ||
    typeof payload.node !== 'string' ||
    typeof payload.salt !== 'string'
  ) {
    return null;
  }

  return { uid: payload.uid, expires: payload.expires, node: payload.node, salt: payload.salt };
}
