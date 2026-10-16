import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FXA_ERRNO, FxaClientError } from '@libs/fxa-crypto';

import { ValidationError } from '@/types/error';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';

import { useFxaService } from './FxaService';

const mocks = vi.hoisted(() => ({
  accountExists: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('@libs/fxa-crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('@libs/fxa-crypto')>()),
  FxaAuthClient: class {
    accountExists = mocks.accountExists;
    signIn = mocks.signIn;
  },
}));

describe('useFxaService', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('clears the last validation error once a call succeeds', async () => {
    mocks.accountExists.mockResolvedValue(true);
    const errorStore = useErrorStore();
    errorStore.setValidationError(new ValidationError(null, { email: { message: 'Old error' } }));

    await expect(useFxaService().accountExists('sam@example.com')).resolves.toBe(true);

    expect(errorStore.getFieldError(null, 'email')).toBeUndefined();
  });

  it('clears every toast once a sign-in succeeds, but not after a check', async () => {
    mocks.accountExists.mockResolvedValue(true);
    mocks.signIn.mockResolvedValue({ sessionToken: 'a'.repeat(64) });
    const notificationStore = useNotificationStore();
    notificationStore.addToast('Copied', 'The link is on your clipboard.');

    await useFxaService().accountExists('sam@example.com');

    expect(notificationStore.notifications).toHaveLength(1);

    await useFxaService().signIn('sam@example.com', 'a password');

    expect(notificationStore.notifications).toEqual([]);
  });

  it('answers a refusal about one field as a validation error', async () => {
    mocks.accountExists.mockRejectedValue(new FxaClientError(400, FXA_ERRNO.UNKNOWN_ACCOUNT, 'Unknown account'));

    await expect(useFxaService().accountExists('sam@example.com')).rejects.toBeInstanceOf(ValidationError);
  });
});
