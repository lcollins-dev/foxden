/** The scope whose key encrypts Sync data; the only key-bearing scope this server serves. */
export const OLDSYNC_SCOPE = 'https://identity.mozilla.com/apps/oldsync';

export interface IOauthClient {
  id: string;
  name: string;
  redirectUri: string;
}

/** Public clients, all using PKCE. Every client may ask for `profile`, `profile:*` and oldsync. */
export const OAUTH_CLIENTS: readonly IOauthClient[] = [
  // FX_OAUTH_CLIENT_ID in ff/services/fxaccounts/FxAccountsCommon.sys.mjs; fxa-auth-server/config/dev.json.
  {
    id: '5882386c6d801776',
    name: 'Firefox',
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel',
  },
  // fenix/app/src/main/java/org/mozilla/fenix/components/FxaServer.kt.
  {
    id: 'a2270f727f45f648',
    name: 'Firefox for Android',
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel',
  },
  // firefox-ios/RustFxA/RustFirefoxAccounts.swift.
  {
    id: '1b1a3e44c54fbb58',
    name: 'Firefox for iOS',
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel',
  },
];

export function findClient(clientId: string): IOauthClient | undefined {
  return OAUTH_CLIENTS.find(client => client.id === clientId);
}

/** Space-separated scopes, de-duplicated in request order. */
export function parseScope(scope: string): string[] {
  return [...new Set(scope.split(/\s+/).filter(entry => entry.length > 0))];
}

export function isAllowedScope(scope: string): boolean {
  return scope === 'profile' || scope.startsWith('profile:') || scope === OLDSYNC_SCOPE;
}

/** Whether `granted` covers `requested`; `profile` covers every `profile:*` sub-scope, as in Mozilla's ScopeSet. */
export function scopeCovers(granted: readonly string[], requested: string): boolean {
  return granted.includes(requested) || (requested.startsWith('profile:') && granted.includes('profile'));
}
