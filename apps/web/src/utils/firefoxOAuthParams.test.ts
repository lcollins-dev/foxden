import { describe, expect, it } from 'vitest';

import { readFirefoxOAuthParams } from './firefoxOAuthParams';

const REQUIRED = {
  client_id: 'a2270f727f45f648',
  state: 'state',
  scope: 'profile https://identity.mozilla.com/apps/oldsync',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  keys_jwk: 'jwk',
};

describe('readFirefoxOAuthParams', () => {
  it('reads what Firefox for Android sends, with sync as the default service and the email to sign in again', () => {
    const query = new URLSearchParams({ ...REQUIRED, context: 'oauth_webchannel_v1', email: 'ada@example.com' });

    expect(readFirefoxOAuthParams(query)).toMatchObject({
      service: 'sync',
      clientId: REQUIRED.client_id,
      email: 'ada@example.com',
    });
  });

  it('leaves the email empty when Firefox names none', () => {
    expect(readFirefoxOAuthParams(new URLSearchParams(REQUIRED))).toMatchObject({ email: '' });
  });

  it('names every missing param', () => {
    expect(readFirefoxOAuthParams(new URLSearchParams({ state: 'state' }))).toEqual({
      missing: ['client_id', 'scope', 'code_challenge', 'code_challenge_method', 'keys_jwk'],
    });
  });
});
