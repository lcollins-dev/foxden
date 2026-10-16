import { afterEach, describe, expect, it, vi } from 'vitest';

import { bytesToHex, hexToBytes, xorBytes } from './bytes';
import { FXA_ERRNO, FxaAuthClient, FxaClientError } from './client';
import { deriveTokenKeys, hkdf, KW_PREFIX, stretchPasswordV2 } from './onepw';

const CLIENT_SALT = 'identity.mozilla.com/picl/v1/quickStretchV2:0123456789abcdef0123456789abcdef';

// v2 vector computed independently with node:crypto, as Mozilla publishes none, for password "pässwörd".
const AUTH_PW_V2 = 'd278c764bd1852a14bfc4e9d8c1682b4f1a57edb9a9372bf8c370cc41592155b';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const mockFetch = (...responses: Response[]) => {
  const fetchMock = vi.fn<typeof fetch>();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

const requestBody = (fetchMock: ReturnType<typeof mockFetch>, call: number): unknown =>
  JSON.parse(fetchMock.mock.calls[call][1]?.body as string);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FxaAuthClient.signIn', () => {
  it('stretches with the account salt and sends the v2 authPW', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, { currentVersion: 'v2', clientSalt: CLIENT_SALT, upgradeNeeded: false }),
      jsonResponse(200, { uid: 'a'.repeat(32), sessionToken: 'b'.repeat(64), authAt: 1759230000 })
    );

    const session = await new FxaAuthClient('https://foxden.test/auth/v1').signIn('user@example.com', 'pässwörd');

    expect(fetchMock.mock.calls[1][0]).toBe('https://foxden.test/auth/v1/account/login');
    expect(requestBody(fetchMock, 1)).toEqual({ email: 'user@example.com', authPW: AUTH_PW_V2 });
    expect(session).toEqual({
      uid: 'a'.repeat(32),
      email: 'user@example.com',
      sessionToken: 'b'.repeat(64),
      authAt: 1759230000,
    });
  }, 30_000);

  it('retries once with the stored address on errno 120', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, { currentVersion: 'v2', clientSalt: CLIENT_SALT, upgradeNeeded: false }),
      jsonResponse(400, { code: 400, errno: 120, message: 'Incorrect email case', email: 'User@Example.com' }),
      jsonResponse(200, { uid: 'a'.repeat(32), sessionToken: 'b'.repeat(64), authAt: 1759230000 })
    );

    const session = await new FxaAuthClient('https://foxden.test/auth/v1').signIn('user@example.com', 'pässwörd');

    expect(requestBody(fetchMock, 2)).toEqual({ email: 'User@Example.com', authPW: AUTH_PW_V2 });
    expect(session.email).toBe('User@Example.com');
  }, 30_000);

  it("throws Mozilla's errno for an unknown account", async () => {
    mockFetch(jsonResponse(400, { code: 400, errno: 102, message: 'Unknown account' }));

    const error = await new FxaAuthClient('https://foxden.test/auth/v1')
      .signIn('nobody@example.com', 'password')
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FxaClientError);
    expect(error).toMatchObject({ code: 400, errno: FXA_ERRNO.UNKNOWN_ACCOUNT, message: 'Unknown account' });
  });

  it('reports a non-JSON failure with errno 999', async () => {
    mockFetch(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }));

    await expect(new FxaAuthClient('https://foxden.test/auth/v1').accountExists('a@example.com')).rejects.toMatchObject(
      {
        code: 502,
        errno: 999,
      }
    );
  });
});

/** The server half of `/account/keys` (fxa-auth-server/lib/tokens/key_fetch_token.js), for a mocked response. */
const bundleFor = async (keyFetchToken: string, kA: Uint8Array, wrapKb: Uint8Array): Promise<string> => {
  const { extraKey } = await deriveTokenKeys(keyFetchToken, 'keyFetchToken');
  const responseKeys = await hkdf(extraKey, `${KW_PREFIX}account/keys`, 96);
  const ciphertext = xorBytes(new Uint8Array([...kA, ...wrapKb]), responseKeys.slice(32, 96));

  const macKey = await crypto.subtle.importKey(
    'raw',
    responseKeys.slice(0, 32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, ciphertext));

  return bytesToHex(new Uint8Array([...ciphertext, ...mac]));
};

describe('FxaAuthClient.changePassword', () => {
  const KEY_FETCH_TOKEN = 'c'.repeat(64);
  const PASSWORD_CHANGE_TOKEN = 'd'.repeat(64);
  const SESSION_TOKEN_ID = 'e'.repeat(64);
  const KB = hexToBytes('0f'.repeat(32));

  it('unwraps kB with the old password and sends it wrapped with the new one', async () => {
    const oldStretched = await stretchPasswordV2('old password', CLIENT_SALT);
    const newStretched = await stretchPasswordV2('new password', CLIENT_SALT);

    const fetchMock = mockFetch(
      jsonResponse(200, { currentVersion: 'v2', clientSalt: CLIENT_SALT, upgradeNeeded: false }),
      jsonResponse(200, {
        keyFetchToken2: KEY_FETCH_TOKEN,
        passwordChangeToken: PASSWORD_CHANGE_TOKEN,
        verified: true,
      }),
      jsonResponse(200, {
        bundle: await bundleFor(KEY_FETCH_TOKEN, new Uint8Array(32), xorBytes(KB, oldStretched.unwrapBKey)),
      }),
      jsonResponse(200, { uid: 'a'.repeat(32), sessionToken: 'b'.repeat(64), verified: true, authAt: 1759230001 })
    );

    const session = await new FxaAuthClient('https://foxden.test/auth/v1').changePassword({
      email: 'user@example.com',
      oldPassword: 'old password',
      newPassword: 'new password',
      sessionTokenId: SESSION_TOKEN_ID,
    });

    expect(fetchMock.mock.calls[1][0]).toBe('https://foxden.test/auth/v1/password/change/start');
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: `Bearer fxs_${SESSION_TOKEN_ID}` });
    expect(requestBody(fetchMock, 1)).toEqual({
      email: 'user@example.com',
      oldAuthPW: bytesToHex(oldStretched.authPW),
    });

    const { tokenId } = await deriveTokenKeys(PASSWORD_CHANGE_TOKEN, 'passwordChangeToken');

    expect(fetchMock.mock.calls[3][0]).toBe('https://foxden.test/auth/v1/password/change/finish');
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ Authorization: `Bearer fxpc_${tokenId}` });
    expect(requestBody(fetchMock, 3)).toEqual({
      authPWVersion2: bytesToHex(newStretched.authPW),
      wrapKbVersion2: bytesToHex(xorBytes(KB, newStretched.unwrapBKey)),
      clientSalt: CLIENT_SALT,
      sessionToken: SESSION_TOKEN_ID,
    });

    expect(session).toEqual({
      uid: 'a'.repeat(32),
      email: 'user@example.com',
      sessionToken: 'b'.repeat(64),
      authAt: 1759230001,
    });
  }, 60_000);

  it('stops at an incorrect current password', async () => {
    mockFetch(
      jsonResponse(200, { currentVersion: 'v2', clientSalt: CLIENT_SALT, upgradeNeeded: false }),
      jsonResponse(400, { code: 400, errno: 103, message: 'Incorrect password' })
    );

    await expect(
      new FxaAuthClient('https://foxden.test/auth/v1').changePassword({
        email: 'user@example.com',
        oldPassword: 'wrong',
        newPassword: 'new password',
        sessionTokenId: SESSION_TOKEN_ID,
      })
    ).rejects.toMatchObject({ errno: FXA_ERRNO.INCORRECT_PASSWORD });
  }, 30_000);
});

describe('FxaAuthClient.authPw', () => {
  it('stretches with the account salt', async () => {
    mockFetch(jsonResponse(200, { currentVersion: 'v2', clientSalt: CLIENT_SALT, upgradeNeeded: false }));

    expect(await new FxaAuthClient('https://foxden.test/auth/v1').authPw('user@example.com', 'pässwörd')).toBe(
      AUTH_PW_V2
    );
  }, 30_000);
});
