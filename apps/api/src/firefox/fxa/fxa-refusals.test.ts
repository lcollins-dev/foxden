import { describe, expect, it } from 'vitest';

import { fxaErrorForRefusal } from './fxa-refusals';
import { DeviceRefusedError } from '@/core/device/device-refusal';
import { OauthRefusedError } from '@/core/oauth/oauth-refusal';
import { AccountRefusedError } from '@/core/user/account-refusal';

describe('fxaErrorForRefusal', () => {
  it.each<[string, Error, Record<string, unknown>]>([
    ['an invalid invite', new AccountRefusedError({ reason: 'invalid-invite' }), { code: 400, errno: 207 }],
    [
      'an existing account',
      new AccountRefusedError({ reason: 'account-exists', email: 'a@example.com' }),
      { errno: 101, email: 'a@example.com' },
    ],
    [
      'an unknown account',
      new AccountRefusedError({ reason: 'unknown-account', email: 'a@example.com' }),
      { errno: 102, email: 'a@example.com' },
    ],
    ['a disabled account', new AccountRefusedError({ reason: 'account-disabled' }), { errno: 240 }],
    ['a wrong password', new AccountRefusedError({ reason: 'incorrect-password' }), { errno: 103 }],
    [
      'a differently cased email',
      new AccountRefusedError({ reason: 'incorrect-email-case', storedEmail: 'A@example.com' }),
      { errno: 120, email: 'A@example.com' },
    ],
    [
      'a spent keyFetchToken',
      new AccountRefusedError({ reason: 'invalid-key-fetch-token' }),
      { code: 401, errno: 110 },
    ],
    [
      'a spent passwordChangeToken',
      new AccountRefusedError({ reason: 'invalid-password-change-token' }),
      { code: 401, errno: 110 },
    ],
    [
      'another account`s session',
      new AccountRefusedError({ reason: 'invalid-session-token' }),
      { code: 401, errno: 110, message: 'Invalid session token' },
    ],
    ['an account held to setup', new AccountRefusedError({ reason: 'setup-required' }), { code: 400, errno: 250 }],
    [
      'half a push subscription',
      new DeviceRefusedError({ reason: 'incomplete-push' }),
      { errno: 108, param: 'pushCallback, pushPublicKey and pushAuthKey go together' },
    ],
    [
      'a bad command',
      new DeviceRefusedError({ reason: 'invalid-available-commands' }),
      { errno: 107, validation: { keys: ['availableCommands'] } },
    ],
    ['an unknown device', new DeviceRefusedError({ reason: 'unknown-device' }), { errno: 123 }],
    [
      'another session`s device',
      new DeviceRefusedError({ reason: 'session-has-device', deviceId: 'd' }),
      { errno: 124, deviceId: 'd' },
    ],
    [
      'an unknown client',
      new OauthRefusedError({ reason: 'unknown-client', clientId: 'c' }),
      { errno: 162, clientId: 'c' },
    ],
    [
      'a disallowed scope',
      new OauthRefusedError({ reason: 'invalid-scopes', invalidScopes: 'openid' }),
      { errno: 163, invalidScopes: 'openid' },
    ],
    ['an unknown code', new OauthRefusedError({ reason: 'unknown-authorization-code' }), { errno: 172 }],
    [
      'another client`s code',
      new OauthRefusedError({ reason: 'mismatched-authorization-code', clientId: 'c' }),
      { errno: 173, clientId: 'c' },
    ],
    [
      'an expired code',
      new OauthRefusedError({ reason: 'expired-authorization-code', expiredAt: 5 }),
      { errno: 174, expiredAt: 5 },
    ],
    ['a wrong verifier', new OauthRefusedError({ reason: 'invalid-pkce-challenge' }), { errno: 175 }],
    ['a disabled account', new OauthRefusedError({ reason: 'account-disabled' }), { errno: 240 }],
    ['an account held to setup', new OauthRefusedError({ reason: 'setup-required' }), { errno: 250 }],
    [
      'an unknown refresh token',
      new OauthRefusedError({ reason: 'invalid-refresh-token' }),
      { code: 401, errno: 110, message: 'Invalid token' },
    ],
  ])('answers %s with Mozilla`s errno', (_case, refusal, body) => {
    expect(fxaErrorForRefusal(refusal)?.body).toMatchObject(body);
  });

  it('passes over anything that is not a refusal', () => {
    expect(fxaErrorForRefusal(new Error('boom'))).toBeNull();
  });
});
