import { hkdfSync } from 'node:crypto';

export type TokenKind = 'sessionToken' | 'keyFetchToken' | 'passwordChangeToken';

// fxa-auth-server/lib/routes/auth-schemes/bearer-fxa-token.js
const BEARER_PREFIX: Record<TokenKind, string> = {
  sessionToken: 'fxs',
  keyFetchToken: 'fxk',
  passwordChangeToken: 'fxpc',
};

const TOKEN_ID_PATTERN = /^[0-9a-f]{64}$/;

const HAWK_ATTRIBUTE_PATTERN = /(\w+)="([^"\\]*)"/g;

/**
 * Reads the token id from `Bearer fxs_<id>` / `fxk_<id>` / `fxpc_<id>` (Firefox 154+) or from the `id` attribute of a
 * Hawk header (older Firefox). The Hawk MAC is not checked, as Mozilla's auth server no longer checks it
 * (fxa-auth-server/lib/routes/auth-schemes/hawk-fxa-token.js), so both schemes are bearer credentials.
 */
export function readTokenId(authorization: string | undefined, kind: TokenKind): string | null {
  if (authorization === undefined) {
    return null;
  }

  const bearer = new RegExp(`^Bearer ${BEARER_PREFIX[kind]}_([0-9a-f]{64})$`).exec(authorization);

  if (bearer !== null) {
    return bearer[1];
  }

  if (!/^Hawk\s/i.test(authorization)) {
    return null;
  }

  for (const [, name, value] of authorization.matchAll(HAWK_ATTRIBUTE_PATTERN)) {
    if (name === 'id') {
      return TOKEN_ID_PATTERN.test(value) ? value : null;
    }
  }

  return null;
}

/** Splits a 32-byte token seed into its id and the key beside it (fxa-auth-server/lib/tokens/token.js). */
export function deriveTokenId(seedHex: string, kind: TokenKind): { tokenId: string; extraKey: Buffer } {
  const derived = Buffer.from(
    hkdfSync('sha256', Buffer.from(seedHex, 'hex'), Buffer.alloc(0), `identity.mozilla.com/picl/v1/${kind}`, 96)
  );

  return { tokenId: derived.subarray(0, 32).toString('hex'), extraKey: derived.subarray(64, 96) };
}
