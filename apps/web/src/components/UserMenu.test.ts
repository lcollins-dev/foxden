import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/stores/user';

import UserMenu from './UserMenu.vue';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  push: vi.fn(),
}));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ logout: mocks.logout }),
}));

const mountUserMenu = (name = 'Ann Lee') => {
  const pinia = createPinia();
  setActivePinia(pinia);

  useUserStore().setProfile({
    uid: 'a'.repeat(32),
    name,
    email: 'ann@example.com',
    userRoleIds: [],
    mustChangePassword: false,
  });

  return mount(UserMenu, { global: { plugins: [pinia] }, attachTo: document.body });
};

const chip = (wrapper: ReturnType<typeof mountUserMenu>) => wrapper.get('[data-testid="user-menu"]');

beforeEach(() => {
  mocks.logout.mockResolvedValue(undefined);
  mocks.push.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('UserMenu', () => {
  it('shows the name and its initial, falling back to the email', () => {
    expect(chip(mountUserMenu()).text()).toBe('AAnn Lee');
    expect(chip(mountUserMenu('')).text()).toBe('Aann@example.com');
  });

  it('opens a menu named for the account from the chip and says so', async () => {
    const wrapper = mountUserMenu();

    expect(chip(wrapper).attributes('aria-expanded')).toBe('false');
    expect(chip(wrapper).attributes('aria-haspopup')).toBe('menu');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await chip(wrapper).trigger('click');

    const menu = wrapper.get('[role="menu"]');

    expect(chip(wrapper).attributes('aria-expanded')).toBe('true');
    expect(
      wrapper
        .get(`[id="${chip(wrapper).attributes('aria-controls')}"]`)
        .find('[role="menu"]')
        .exists()
    ).toBe(true);
    expect(menu.findAll('[role="menuitem"]').map(item => item.text())).toEqual(['Profile & security', 'Sign out']);
    expect(wrapper.text()).toContain('ann@example.com');
  });

  it('closes and opens the account page', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[data-testid="menu-item-account"]').trigger('click');

    expect(mocks.push).toHaveBeenCalledWith('/profile-and-security');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes, signs out and returns to the sign in page', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[data-testid="menu-item-sign-out"]').trigger('click');
    await flushPromises();

    expect(mocks.logout).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/sign-in');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes on Tab', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Tab' });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes on Escape and hands focus back to the chip', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(chip(wrapper).element);
  });
});
