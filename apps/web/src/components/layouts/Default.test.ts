import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useUserStore } from '@/stores/user';

import AppFooter from '@/components/AppFooter.vue';

import Default from './Default.vue';

const JSDOM_WIDTH = window.innerWidth;
const WIDE_WIDTH = 1280;
const NARROW_WIDTH = 400;

const signIn = () => {
  const userStore = useUserStore();

  userStore.setToken('token');
  userStore.setProfile({
    uid: 'a'.repeat(32),
    name: 'Ann Lee',
    email: 'ann@example.com',
    userRoleIds: [],
    mustChangePassword: false,
  });
};

const mountAt = async (path: string) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  signIn();

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push(path);

  const wrapper = mount(Default, {
    global: { plugins: [pinia, router], stubs: { UserMenu: true } },
    attachTo: document.body,
  });

  return { wrapper, router };
};

type TWrapper = Awaited<ReturnType<typeof mountAt>>['wrapper'];

const menuButton = (wrapper: TWrapper) => wrapper.get('button[aria-label="Menu"]');
const drawer = (wrapper: TWrapper) => wrapper.find('[data-testid="sidebar-drawer"]');
const scrim = (wrapper: TWrapper) => wrapper.find('[data-testid="sidebar-scrim"]');

const openDrawer = async () => {
  window.innerWidth = NARROW_WIDTH;

  const mounted = await mountAt('/devices');
  await menuButton(mounted.wrapper).trigger('click');

  return mounted;
};

beforeEach(() => {
  window.innerWidth = WIDE_WIDTH;
});

afterEach(() => {
  window.innerWidth = JSDOM_WIDTH;
  document.body.innerHTML = '';
});

describe('Default layout', () => {
  it('ends in the footer linking to the source code', async () => {
    const { wrapper } = await mountAt('/');

    expect(wrapper.findComponent(AppFooter).exists()).toBe(true);
  });

  it('shows the side menu inline with no menu button on a wide screen', async () => {
    const { wrapper } = await mountAt('/devices');

    expect(wrapper.find('nav[aria-label="Main"]').exists()).toBe(true);
    expect(drawer(wrapper).exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Menu"]').exists()).toBe(false);
  });

  it('keeps the side menu behind the menu button on a narrow screen until it opens the drawer', async () => {
    window.innerWidth = NARROW_WIDTH;

    const { wrapper } = await mountAt('/devices');

    expect(wrapper.find('nav').exists()).toBe(false);
    expect(menuButton(wrapper).attributes('aria-expanded')).toBe('false');
    expect(menuButton(wrapper).attributes('aria-controls')).toBe('side-menu');

    await menuButton(wrapper).trigger('click');

    expect(drawer(wrapper).attributes('id')).toBe('side-menu');
    expect(scrim(wrapper).exists()).toBe(true);
    expect(menuButton(wrapper).attributes('aria-expanded')).toBe('true');
  });

  it('closes the drawer on a click on the scrim', async () => {
    const { wrapper } = await openDrawer();

    await scrim(wrapper).trigger('click');

    expect(drawer(wrapper).exists()).toBe(false);
    expect(scrim(wrapper).exists()).toBe(false);
  });

  it('closes the drawer on Escape', async () => {
    const { wrapper } = await openDrawer();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(drawer(wrapper).exists()).toBe(false);
  });

  it('closes the drawer on a route change', async () => {
    const { wrapper, router } = await openDrawer();

    await router.push('/getting-started');
    await flushPromises();

    expect(drawer(wrapper).exists()).toBe(false);
  });

  it('closes the drawer when the screen widens', async () => {
    const { wrapper } = await openDrawer();

    window.innerWidth = WIDE_WIDTH;
    window.dispatchEvent(new Event('resize'));
    await flushPromises();

    expect(drawer(wrapper).exists()).toBe(false);
    expect(wrapper.find('nav[aria-label="Main"]').exists()).toBe(true);

    window.innerWidth = NARROW_WIDTH;
    window.dispatchEvent(new Event('resize'));
    await flushPromises();

    expect(wrapper.find('nav').exists()).toBe(false);
  });
});
