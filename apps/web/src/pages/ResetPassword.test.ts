import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordResetState } from '@libs/dto';

import { useNotificationStore } from '@/stores/notification';

import ResetPassword from './ResetPassword.vue';

const mocks = vi.hoisted(() => ({
  checkPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  getProfile: vi.fn(),
  push: vi.fn(),
}));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { token: 'a'.repeat(64) } }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/services/api/PasswordResetService', () => ({
  usePasswordResetService: () => ({
    checkPasswordReset: mocks.checkPasswordReset,
    resetPassword: mocks.resetPassword,
  }),
}));

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ getProfile: mocks.getProfile }),
}));

const VALID = {
  state: PasswordResetState.VALID,
  passwordReset: { email: 'ann@example.com', expiresAt: '2026-10-03T09:00:00.000Z' },
};

const mountPage = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mount(ResetPassword, {
    global: { plugins: [pinia], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });

  await flushPromises();

  return wrapper;
};

const fillPasswords = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
  await wrapper.get('input[name="password"]').setValue('a new password');
  await wrapper.get('input[name="confirm-password"]').setValue('a new password');
};

const submitReset = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
  await fillPasswords(wrapper);
  await wrapper.get('[data-testid="reset-password-understood"]').setValue(true);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
};

const submitButton = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.get('button[type="submit"]');

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('warns that server-only data is lost and waits for the user to say they understand', async () => {
    mocks.checkPasswordReset.mockResolvedValue(VALID);
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="reset-password-warning"]').text()).toContain(
      'Data stored only on this server will be lost.'
    );

    await fillPasswords(wrapper);
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="reset-password-understood"]').setValue(true);
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it.each([
    [PasswordResetState.INVALID, "This Reset Link Isn't Valid"],
    [PasswordResetState.EXPIRED, 'This Reset Link Has Expired'],
    [PasswordResetState.USED, 'This Reset Link Has Already Been Used'],
  ])('says a %s link cannot be used', async (state, title) => {
    mocks.checkPasswordReset.mockResolvedValue({ state, passwordReset: null });
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="reset-password-problem"]').text()).toContain(title);
    expect(wrapper.find('[data-testid="reset-password-form"]').exists()).toBe(false);
  });

  it('reads a link the server refuses to check, such as a truncated one, as not valid', async () => {
    mocks.checkPasswordReset.mockRejectedValue(new Error('400'));
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="reset-password-problem"]').text()).toContain("This Reset Link Isn't Valid");
  });

  it('checks the link again when it went while the page was open, and shows why', async () => {
    mocks.checkPasswordReset
      .mockResolvedValueOnce(VALID)
      .mockResolvedValueOnce({ state: PasswordResetState.USED, passwordReset: null });
    mocks.resetPassword.mockRejectedValue(new Error("This reset link doesn't work any more."));
    const wrapper = await mountPage();

    await fillPasswords(wrapper);
    await wrapper.get('[data-testid="reset-password-understood"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.checkPasswordReset).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-testid="reset-password-problem"]').text()).toContain(
      'This Reset Link Has Already Been Used'
    );
  });

  it('stays on the form after a refusal while the link is still valid', async () => {
    mocks.checkPasswordReset.mockResolvedValue(VALID);
    mocks.resetPassword.mockRejectedValue(new Error('This account is disabled. Ask your admin to enable it.'));
    const wrapper = await mountPage();

    await fillPasswords(wrapper);
    await wrapper.get('[data-testid="reset-password-understood"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.resetPassword).toHaveBeenCalledWith('a'.repeat(64), 'a new password');
    expect(mocks.checkPasswordReset).toHaveBeenCalledTimes(2);
    expect(wrapper.find('input[name="password"]').exists()).toBe(true);
  });

  it('signs the web app in with the new session and opens Getting started', async () => {
    mocks.checkPasswordReset.mockResolvedValue(VALID);
    mocks.resetPassword.mockResolvedValue('e'.repeat(64));
    const wrapper = await mountPage();

    await submitReset(wrapper);

    await vi.waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/getting-started');
    });
    expect(localStorage.getItem('token')).toMatch(/fxs_[0-9a-f]{64}/);
    expect(mocks.getProfile).toHaveBeenCalled();
  });

  it('says the password was reset, without checking the link again, when signing in afterwards fails', async () => {
    mocks.checkPasswordReset.mockResolvedValue(VALID);
    mocks.resetPassword.mockResolvedValue('e'.repeat(64));
    mocks.getProfile.mockRejectedValue(new Error('Network Error'));
    const wrapper = await mountPage();

    await submitReset(wrapper);

    await vi.waitFor(() => {
      expect(useNotificationStore().notifications).toEqual([
        expect.objectContaining({
          content: 'Your password was reset, but signing you in failed. Sign in with your new password.',
        }),
      ]);
    });
    expect(mocks.checkPasswordReset).toHaveBeenCalledTimes(1);
  });
});
