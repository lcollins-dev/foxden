import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPasswordCredentials, deriveTokenKeys, FxaAuthClient } from '@libs/fxa-crypto';

import { PACKAGE_ROOT } from './paths.ts';

/** Seeded by the api's test migration 9000000000001-TestAdmin when USE_TEST_MIGRATIONS is on. */
export const TEST_ADMIN = {
  email: process.env.SYNC_ADMIN_EMAIL ?? 'admin@foxden.test',
  password: process.env.SYNC_ADMIN_PASSWORD ?? 'TestPass123!',
};

// Mirrors resources/instanced/env.sh: the web port of this checkout's dev instance.
function instanceUrl(): string {
  const instanceFile = join(PACKAGE_ROOT, '..', '.workdir', 'instance');
  const instance = existsSync(instanceFile) ? Number(readFileSync(instanceFile, 'utf8').trim()) : 1;

  return `http://localhost:${8080 + instance * 100}`;
}

export const SERVER_URL = (process.env.SYNC_SERVER_URL ?? instanceUrl()).replace(/\/+$/, '');

export const authClient = new FxaAuthClient(`${SERVER_URL}/auth/v1`);

export function uniqueEmail(label: string): string {
  return `ff-${label}-${Date.now()}-${Math.floor(Math.random() * 100_000)}@foxden.test`;
}

async function apiRequest(path: string, token: string, body: unknown, method = 'POST'): Promise<unknown> {
  const response = await fetch(`${SERVER_URL}/api/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${method} /api/v1/${path} answered ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function asTestAdmin<T>(work: (token: string) => Promise<T>): Promise<T> {
  const session = await authClient.signIn(TEST_ADMIN.email, TEST_ADMIN.password);
  const { tokenId } = await deriveTokenKeys(session.sessionToken, 'sessionToken');

  try {
    return await work(`fxs_${tokenId}`);
  } finally {
    await authClient.destroySession(session.sessionToken);
  }
}

function readLink(response: unknown): string {
  if (typeof response !== 'object' || response === null || !('link' in response) || typeof response.link !== 'string') {
    throw new Error('The response has no link');
  }

  return response.link;
}

export async function createInvite(email: string): Promise<string> {
  return asTestAdmin(async token =>
    readLink(await apiRequest('admin/invite', token, { email, name: 'Firefox E2E', admin: false }))
  );
}

async function findUserId(token: string, email: string): Promise<number> {
  const body = await apiRequest('admin/user/list?page=1', token, { search: email, status: 'all' }, 'PATCH');
  const userList = typeof body === 'object' && body !== null && 'userList' in body ? body.userList : [];
  const users: unknown[] = Array.isArray(userList) ? userList : [];
  const user = users.find(
    entry => typeof entry === 'object' && entry !== null && 'email' in entry && entry.email === email
  );

  if (typeof user !== 'object' || user === null || !('id' in user) || typeof user.id !== 'number') {
    throw new Error(`No account for ${email}`);
  }

  return user.id;
}

/** Resets an account's password as the admin's reset link and our reset page do, re-keying the account. */
export async function resetPassword(email: string, password: string): Promise<void> {
  const link = await asTestAdmin(async token =>
    readLink(await apiRequest(`admin/user/${await findUserId(token, email)}/password-reset`, token, {}))
  );
  const response = await fetch(`${SERVER_URL}/api/v1/password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: link.split('/').pop() ?? '', ...(await createPasswordCredentials(password)) }),
  });

  if (!response.ok) {
    throw new Error(`POST /api/v1/password-reset answered ${response.status}: ${await response.text()}`);
  }
}
