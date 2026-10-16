import { IClaimedKeys } from '@/core/tokenserver/tokenserver.service';

import { tokenserverErrors } from './tokenserver-error';

// HTTP header values are visible ASCII plus space and tab (actix `HeaderValue::to_str`).
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7e]*$/;
const BASE64URL_NO_PAD_PATTERN = /^[A-Za-z0-9_-]*$/;
const CLIENT_STATE_PATTERN = /^[a-zA-Z0-9._-]{1,32}$/;
const INTEGER_PATTERN = /^\+?[0-9]+$/;

function decodeBase64UrlNoPad(encoded: string): Buffer | null {
  if (!BASE64URL_NO_PAD_PATTERN.test(encoded)) {
    return null;
  }

  const decoded = Buffer.from(encoded, 'base64url');

  // Node decodes leniently; only the canonical encoding round-trips.
  return decoded.toString('base64url') === encoded ? decoded : null;
}

/**
 * Parses `X-KeyID: <keys_changed_at>-<base64url fingerprint>` and checks the legacy `X-Client-State` against it, in
 * the order syncstorage-rs does, so the same error wins (syncstorage-rs `syncserver/src/tokenserver/extractors.rs`).
 */
export function parseKeyId(keyIdHeader: string | undefined, clientStateHeader: string | undefined): IClaimedKeys {
  if (keyIdHeader === undefined) {
    throw tokenserverErrors.missingKeyId();
  }

  if (!HEADER_VALUE_PATTERN.test(keyIdHeader)) {
    throw tokenserverErrors.invalidKeyId();
  }

  const separator = keyIdHeader.indexOf('-');

  if (separator === -1) {
    throw tokenserverErrors.invalidCredentials();
  }

  const fingerprint = decodeBase64UrlNoPad(keyIdHeader.slice(separator + 1));

  if (fingerprint === null) {
    throw tokenserverErrors.invalidCredentials();
  }

  const clientState = fingerprint.toString('hex');

  if (clientStateHeader !== undefined) {
    if (!CLIENT_STATE_PATTERN.test(clientStateHeader)) {
      throw tokenserverErrors.malformedClientState();
    }

    if (clientStateHeader !== clientState) {
      throw tokenserverErrors.clientStateMismatch();
    }
  }

  const keysChangedAtText = keyIdHeader.slice(0, separator);
  const keysChangedAt = Number(keysChangedAtText);

  if (!INTEGER_PATTERN.test(keysChangedAtText) || !Number.isSafeInteger(keysChangedAt)) {
    throw tokenserverErrors.invalidCredentials();
  }

  return { keysChangedAt: keysChangedAt === 0 ? null : keysChangedAt, clientState };
}
