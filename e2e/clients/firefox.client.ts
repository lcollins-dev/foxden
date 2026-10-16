import { type APIRequestContext, expect } from '@playwright/test';

import { deriveTokenKeys } from '@libs/fxa-crypto';

import { authClient } from '../factories/user.factory';
import { BASE_URL } from '../utils/urls';
import { ISignInCredentials } from '../utils/users';

// Signs in as Firefox does and registers the session's device, so the account has a Firefox on its Devices page.
export const signInFirefoxDevice = async (
  request: APIRequestContext,
  credentials: ISignInCredentials,
  deviceName: string
): Promise<void> => {
  const session = await authClient.signIn(credentials.email, credentials.password);
  const { tokenId } = await deriveTokenKeys(session.sessionToken, 'sessionToken');

  const response = await request.post(`${BASE_URL}/auth/v1/account/device`, {
    headers: { Authorization: `Bearer fxs_${tokenId}` },
    data: { name: deviceName, type: 'desktop' },
  });

  expect(response.status()).toBe(200);
};

export const signInElsewhere = async (credentials: ISignInCredentials): Promise<void> => {
  await authClient.signIn(credentials.email, credentials.password);
};
