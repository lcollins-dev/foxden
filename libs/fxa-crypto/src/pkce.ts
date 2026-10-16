import { base64UrlEncode, randomBytes, utf8 } from './bytes';

/** A 43-character code_verifier, as Firefox generates. */
export function createCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

/** The S256 code_challenge for a code_verifier. */
export async function codeChallengeS256(codeVerifier: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', utf8(codeVerifier))));
}
