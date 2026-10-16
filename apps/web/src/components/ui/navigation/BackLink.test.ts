import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createWebHistory, createRouter } from 'vue-router';

import BackLink from './BackLink.vue';

const mountAt = async ([firstPath, ...laterPaths]: string[]) => {
  window.history.replaceState(null, '', '/');

  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  await router.replace(firstPath);

  for (const path of laterPaths) {
    await router.push(path);
  }

  const wrapper = mount(BackLink, {
    props: { to: '/admin/users', label: 'Users' },
    global: { plugins: [router] },
  });

  return { wrapper, router };
};

describe('UiBackLink', () => {
  it('links to its parent', async () => {
    const { wrapper } = await mountAt(['/admin/users/1']);

    expect(wrapper.get('a').attributes('href')).toBe('/admin/users');
    expect(wrapper.text()).toBe('Users');
  });

  it('returns through history when the previous entry is in this app', async () => {
    const { wrapper, router } = await mountAt(['/devices', '/admin/users/1']);
    const back = vi.spyOn(router, 'back');

    await wrapper.get('a').trigger('click');

    expect(back).toHaveBeenCalled();
  });

  it('falls back to its parent on a deep link', async () => {
    const { wrapper, router } = await mountAt(['/admin/users/1']);

    await wrapper.get('a').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/admin/users');
  });
});
