import { type APIRequestContext } from '@playwright/test';

import { FxaAuthClient } from '@libs/fxa-crypto';

import { createInvite, findUserId, updateUser } from '../clients/admin.client';
import { BASE_URL } from '../utils/urls';
import { ISignInCredentials, TEST_PASSWORD } from '../utils/users';

export interface ITestUser extends ISignInCredentials {
  id: number;
  name: string;
  /** The invite the account was created from, which is now used. */
  inviteToken: string;
}

export interface ICreateTestUserOptions {
  name?: string;
  userRoleIds?: number[];
  password?: string;
}

export const uniqueEmail = (label = 'e2e'): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@foxden.test`;

export const authClient = new FxaAuthClient(`${BASE_URL}/auth/v1`);

// Signs up through an invite the way the invite page does, so a spec that signs in gets an account of its own.
export const createTestUser = async (
  request: APIRequestContext,
  options: ICreateTestUserOptions = {}
): Promise<ITestUser> => {
  const email = uniqueEmail();
  const name = options.name ?? 'E2E User';
  const invite = await createInvite(request, email, name);
  const inviteToken = invite.link.split('/').pop() ?? '';

  const password = options.password ?? TEST_PASSWORD;
  const session = await authClient.signUp({ email, password, inviteToken });
  await authClient.destroySession(session.sessionToken);

  const id = await findUserId(request, email);

  await updateUser(request, id, { name, email, userRoleIds: options.userRoleIds ?? [] });

  return { id, name, email, password, inviteToken };
};
