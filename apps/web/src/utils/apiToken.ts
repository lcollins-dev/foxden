import { deriveTokenKeys } from '@libs/fxa-crypto';

/** The `/api/v1` bearer token for a session: the session token's id with Mozilla's `fxs_` prefix. */
export async function apiTokenForSession(sessionToken: string): Promise<string> {
  const { tokenId } = await deriveTokenKeys(sessionToken, 'sessionToken');

  return `fxs_${tokenId}`;
}

export function sessionTokenIdOf(apiToken: string): string {
  return apiToken.replace(/^fxs_/, '');
}
