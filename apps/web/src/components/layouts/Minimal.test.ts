import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppFooter from '@/components/AppFooter.vue';

import Minimal from './Minimal.vue';

describe('Minimal layout', () => {
  it('ends in the footer linking to the source code', () => {
    const wrapper = mount(Minimal);

    expect(wrapper.findComponent(AppFooter).exists()).toBe(true);
  });
});
