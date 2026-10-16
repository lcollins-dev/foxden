export const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

export const HEX_16_BYTES = /^[0-9a-f]{32}$/;

export const CLIENT_ID = /^[0-9a-f]{16}$/;

export const URL_SAFE_BASE_64 = /^[A-Za-z0-9_-]*$/;

export const PKCE_CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const PKCE_CODE_VERIFIER = /^[A-Za-z0-9-._~]{43,128}$/;

/** fxa-auth-server/lib/routes/validators.js `jwe`. */
export const COMPACT_JWE = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
