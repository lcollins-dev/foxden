import { describe, expect, it } from 'vitest';

import { isFirefoxSurface, RequestSurface, requestSurface } from './request-surface';

describe('requestSurface', () => {
  it.each([
    ['/api/v1/user/profile', RequestSurface.API],
    ['/auth/v1/account/login', RequestSurface.ACCOUNTS],
    ['/oauth/v1/jwks', RequestSurface.ACCOUNTS],
    ['/profile/v1/profile', RequestSurface.ACCOUNTS],
    ['/.well-known/fxa-client-configuration', RequestSurface.ACCOUNTS],
    ['/token/1.0/sync/1.5', RequestSurface.TOKENSERVER],
    ['/token', RequestSurface.TOKENSERVER],
    ['/storage/1.5/1/info/collections', RequestSurface.STORAGE],
    ['/sign-in', RequestSurface.OTHER],
    ['/tokens', RequestSurface.OTHER],
    ['/api/v2/user', RequestSurface.OTHER],
  ])('puts %s on the %s surface', (path, surface) => {
    expect(requestSurface(path)).toBe(surface);
  });

  it('ignores case, as Express routing does', () => {
    expect(requestSurface('/Storage/1.5/1/info/collections')).toBe(RequestSurface.STORAGE);
    expect(requestSurface('/AUTH/v1/session/status')).toBe(RequestSurface.ACCOUNTS);
  });

  it('counts the accounts servers, the tokenserver and storage as Firefox`s', () => {
    expect([RequestSurface.ACCOUNTS, RequestSurface.TOKENSERVER, RequestSurface.STORAGE].every(isFirefoxSurface)).toBe(
      true
    );
    expect([RequestSurface.API, RequestSurface.OTHER].some(isFirefoxSurface)).toBe(false);
  });
});
