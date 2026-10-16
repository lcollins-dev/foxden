import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveTokenKey, ISyncTokenPayload, parseToken } from '@/core/tokenserver/sync-token';

const HAWK_PREFIX = 'Hawk ';
const STANDARD_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const UNSIGNED_PATTERN = /^\+?[0-9]+$/;

/**
 * syncstorage-rs allows 52 weeks of clock skew, since clients' clocks are all over the place and Firefox never
 * retries a Hawk timestamp error; the token's own expiry bounds a replay instead (`syncserver/src/web/auth.rs`).
 */
export const HAWK_SKEW_SECONDS = 52 * 7 * 24 * 60 * 60;

export interface IHawkHeader {
  id?: string;
  ts?: number;
  nonce?: string;
  mac?: Buffer;
  ext?: string;
  hash?: Buffer;
  app?: string;
  dlg?: string;
}

export interface IHawkRequest {
  authorization: string | undefined;
  method: string;
  /** The public path and query exactly as Firefox sent them, undecoded. */
  resource: string;
  host: string;
  port: number;
  nowMs: number;
  /** How long the token stays usable past its expiry, which clients polling `info/collections` rely on. */
  expiryGraceSeconds: number;
}

export interface IHawkSecrets {
  masterSecret: string;
  signingSecret: Buffer;
}

export interface IHawkNormalizedFields {
  ts: number;
  nonce: string;
  method: string;
  resource: string;
  host: string;
  port: number;
  hash?: Buffer;
  ext?: string;
}

/** Standard base64 that must round-trip, as the Rust `base64` crate's strict decoder requires. */
function decodeStandardBase64(value: string): Buffer | null {
  if (!STANDARD_BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64');

  return decoded.toString('base64') === value ? decoded : null;
}

function assignAttribute(header: IHawkHeader, name: string, value: string): boolean {
  switch (name) {
    case 'id':
    case 'nonce':
    case 'ext':
    case 'app':
    case 'dlg':
      header[name] = value;
      return true;
    case 'ts': {
      const ts = Number(value);

      if (!UNSIGNED_PATTERN.test(value) || !Number.isSafeInteger(ts)) {
        return false;
      }

      header.ts = ts;
      return true;
    }
    case 'mac':
    case 'hash': {
      const decoded = decodeStandardBase64(value);

      if (decoded === null) {
        return false;
      }

      header[name] = decoded;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Parses `Hawk id="…", ts="…", …` like rust-hawk's `Header::from_str`: tolerant of spacing and stray commas, no
 * escapes inside quotes, unknown attributes rejected, a repeated attribute overwriting the earlier one.
 */
export function parseHawkHeader(authorization: string): IHawkHeader | null {
  if (!authorization.startsWith(HAWK_PREFIX)) {
    return null;
  }

  const header: IHawkHeader = {};
  let rest = authorization.slice(HAWK_PREFIX.length);

  while (rest !== '') {
    rest = rest.replace(/^[\s,]+/, '');

    const equals = rest.indexOf('=');

    if (equals === -1) {
      return null;
    }

    const name = rest.slice(0, equals).trim();
    rest = rest.slice(equals + 1).trimStart();

    if (!rest.startsWith('"')) {
      return null;
    }

    const closingQuote = rest.indexOf('"', 1);

    if (closingQuote === -1 || !assignAttribute(header, name, rest.slice(1, closingQuote))) {
      return null;
    }

    rest = rest.slice(closingQuote + 1).trimStart();
  }

  return header;
}

export function hawkNormalizedString(fields: IHawkNormalizedFields): string {
  return [
    'hawk.1.header',
    String(fields.ts),
    fields.nonce,
    fields.method.toUpperCase(),
    fields.resource,
    fields.host.toLowerCase(),
    String(fields.port),
    fields.hash === undefined ? '' : fields.hash.toString('base64'),
    fields.ext ?? '',
    '',
  ].join('\n');
}

/** The key is the ASCII of the token's key string, never its decoded bytes. */
export const hawkMac = (key: string, normalized: string): Buffer =>
  createHmac('sha256', Buffer.from(key, 'utf8')).update(normalized, 'utf8').digest();

/**
 * Authenticates a storage request signed with a tokenserver token (syncstorage-rs `HawkPayload::extrude`,
 * `syncserver/src/web/auth.rs`). The payload hash is not checked, as in syncstorage-rs, and there is no nonce cache.
 */
export function verifyHawkRequest(request: IHawkRequest, secrets: IHawkSecrets): ISyncTokenPayload | null {
  if (request.authorization === undefined) {
    return null;
  }

  const header = parseHawkHeader(request.authorization);

  if (header?.id === undefined || header.ts === undefined || header.nonce === undefined || header.mac === undefined) {
    return null;
  }

  const payload = parseToken(header.id, secrets.signingSecret);
  const nowSeconds = Math.floor(request.nowMs / 1000);

  if (payload === null || Math.round(payload.expires) + request.expiryGraceSeconds <= nowSeconds) {
    return null;
  }

  const key = deriveTokenKey(secrets.masterSecret, payload.salt, header.id);
  const expectedMac = hawkMac(
    key,
    hawkNormalizedString({
      ts: header.ts,
      nonce: header.nonce,
      method: request.method,
      resource: request.resource,
      host: request.host,
      port: request.port,
      hash: header.hash,
      ext: header.ext,
    })
  );

  if (header.mac.length !== expectedMac.length || !timingSafeEqual(header.mac, expectedMac)) {
    return null;
  }

  if (Math.abs(nowSeconds - header.ts) > HAWK_SKEW_SECONDS) {
    return null;
  }

  return payload;
}
