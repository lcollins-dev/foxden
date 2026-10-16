import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import Button from './Button.vue';

const mountLink = async (props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  await router.push('/');

  const wrapper = mount(Button, { props, slots: { default: 'Invite User' }, global: { plugins: [router] } });

  return { router, wrapper };
};

describe('Button', () => {
  it('is a plain button unless asked to submit', () => {
    expect(mount(Button).get('button').attributes('type')).toBe('button');
    expect(
      mount(Button, { props: { nativeType: 'submit' } })
        .get('button')
        .attributes('type')
    ).toBe('submit');
  });

  it('emits click', async () => {
    const wrapper = mount(Button);

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('ignores clicks and says it is busy while loading', async () => {
    const wrapper = mount(Button, { props: { loading: true } });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('click')).toBeUndefined();
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('shows the icon slot in place of the spinner when idle', () => {
    const wrapper = mount(Button, { slots: { icon: '<i class="icon" />', default: 'Invite User' } });

    expect(wrapper.find('.icon').exists()).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.text()).toBe('Invite User');
  });

  it('disables the native button', () => {
    expect(
      mount(Button, { props: { disabled: true } })
        .get('button')
        .attributes('disabled')
    ).toBeDefined();
  });

  it('renders a route as one link with the button look, which navigates on click', async () => {
    const { router, wrapper } = await mountLink({ to: '/admin/invites', type: 'primary' });
    const link = wrapper.get('a');

    expect(wrapper.find('button').exists()).toBe(false);
    expect(link.attributes('href')).toBe('/admin/invites');
    expect(link.attributes('type')).toBeUndefined();
    expect(link.classes()).toEqual(expect.arrayContaining(['h-8', 'rounded-lg', 'bg-primary']));
    expect(link.text()).toBe('Invite User');

    await link.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/admin/invites');
  });

  it('renders a disabled route as a link with no href that stays put on click', async () => {
    const { router, wrapper } = await mountLink({ to: '/admin/invites', disabled: true });
    const link = wrapper.get('a');

    expect(link.attributes('href')).toBeUndefined();
    expect(link.attributes('role')).toBe('link');
    expect(link.attributes('aria-disabled')).toBe('true');

    await link.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.emitted('click')).toBeUndefined();
  });
});
