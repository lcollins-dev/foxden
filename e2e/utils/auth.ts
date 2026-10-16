import { readFileSync } from 'node:fs';

import { STORAGE_STATE_PATH } from './paths';
import { BASE_URL } from './urls';

interface IStorageStateOrigin {
  origin: string;
  localStorage: { name: string; value: string }[];
}

interface IStorageState {
  origins: IStorageStateOrigin[];
}

const isStorageState = (value: unknown): value is IStorageState =>
  typeof value === 'object' && value !== null && 'origins' in value && Array.isArray(value.origins);

// Reuses the session auth.setup.ts opened through the sign-in page.
export const readAdminToken = (): string => {
  const parsed: unknown = JSON.parse(readFileSync(STORAGE_STATE_PATH, 'utf-8'));

  if (!isStorageState(parsed)) {
    throw new Error(`Unexpected storage state shape in ${STORAGE_STATE_PATH}`);
  }

  const origin = parsed.origins.find(entry => entry.origin === BASE_URL);
  const token = origin?.localStorage.find(entry => entry.name === 'token')?.value;

  if (token === undefined || token === '') {
    throw new Error(`No admin token in ${STORAGE_STATE_PATH} for origin ${BASE_URL}`);
  }

  return token;
};

export const adminHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${readAdminToken()}` });
