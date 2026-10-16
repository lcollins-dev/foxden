import type { IFirefoxOAuthParams } from '@/types/firefox';

/** The only context Firefox 157 sends: desktop's pref `identity.fxaccounts.contextParam`, and fxa-client's `oauth_flow`. */
export const FIREFOX_CONTEXT = 'oauth_webchannel_v1';

const REQUIRED_PARAMS = ['client_id', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'keys_jwk'];

/** Ignores unknown params: Firefox adds more over time. */
export function readFirefoxOAuthParams(query: URLSearchParams): IFirefoxOAuthParams | { missing: string[] } {
  const missing = REQUIRED_PARAMS.filter(name => (query.get(name) ?? '') === '');

  if (missing.length > 0) {
    return { missing };
  }

  const read = (name: string, fallback = ''): string => query.get(name) ?? fallback;

  return {
    context: read('context'),
    service: read('service', 'sync'),
    clientId: read('client_id'),
    state: read('state'),
    scope: read('scope'),
    accessType: read('access_type', 'online'),
    codeChallenge: read('code_challenge'),
    codeChallengeMethod: read('code_challenge_method'),
    keysJwk: read('keys_jwk'),
    email: read('email'),
  };
}
