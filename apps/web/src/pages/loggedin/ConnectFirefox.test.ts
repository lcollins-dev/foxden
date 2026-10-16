import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';

import ConnectFirefox from './ConnectFirefox.vue';

const serverInfo = vi.hoisted(() => ({ publicUrl: 'https://sync.example.com' }));

vi.mock('@/services/api/ServerService', () => ({
  useServerService: () => ({ getServerInfo: () => Promise.resolve(serverInfo) }),
}));

const mountPage = async (publicUrl = 'https://sync.example.com') => {
  serverInfo.publicUrl = publicUrl;

  const wrapper = mount(ConnectFirefox, { global: { plugins: [createPinia()] } });

  await flushPromises();

  return wrapper;
};

const choosePlatform = async (wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) => {
  const option = wrapper.findAll('[role="radio"]').find(radio => radio.text() === label);

  await option?.trigger('click');
};

describe('ConnectFirefox', () => {
  it('opens on the desktop steps, with the server address to copy', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[role="radio"][aria-checked="true"]').text()).toBe('Desktop');
    expect(wrapper.find('[data-testid="desktop-steps"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="autoconfig-uri"]').text()).toBe('https://sync.example.com');
  });

  it('shows the Sync Debug steps on Android, with the server address to copy', async () => {
    const wrapper = await mountPage();

    await choosePlatform(wrapper, 'Android');

    expect(wrapper.find('[data-testid="desktop-steps"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="android-steps"]').text()).toContain('Sync Debug');
    expect(wrapper.get('[data-testid="android-server-url"]').text()).toBe('https://sync.example.com');
  });

  it('shows the Advanced Sync Settings steps on iOS, with the server address to copy', async () => {
    const wrapper = await mountPage();

    await choosePlatform(wrapper, 'iOS');

    expect(wrapper.get('[data-testid="ios-steps"]').text()).toContain('Advanced Sync Settings');
    expect(wrapper.get('[data-testid="ios-server-url"]').text()).toBe('https://sync.example.com');
  });

  it('adds the plain HTTP step on desktop for localhost, and on Android and iOS says they need HTTPS', async () => {
    const wrapper = await mountPage('http://localhost:3000');

    expect(wrapper.find('[data-testid="allow-http-step"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mobile-needs-https"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="needs-https"]').exists()).toBe(false);

    for (const platform of ['Android', 'iOS']) {
      await choosePlatform(wrapper, platform);

      expect(wrapper.find('[data-testid="allow-http-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="mobile-needs-https"]').exists()).toBe(true);
    }
  });

  it.each(['http://127.0.0.1:3000', 'http://[::1]:3000'])('treats %s as localhost', async publicUrl => {
    const wrapper = await mountPage(publicUrl);

    expect(wrapper.find('[data-testid="allow-http-step"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="needs-https"]').exists()).toBe(false);
  });

  it('says a plain HTTP server anywhere but localhost needs HTTPS, with no plain HTTP step', async () => {
    const wrapper = await mountPage('http://192.0.2.10:3000');

    expect(wrapper.find('[data-testid="needs-https"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="allow-http-step"]').exists()).toBe(false);
  });

  it('says nothing about HTTPS for an HTTPS server', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="needs-https"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="allow-http-step"]').exists()).toBe(false);
  });

  it('says nothing about HTTPS on Android for an HTTPS server', async () => {
    const wrapper = await mountPage();

    await choosePlatform(wrapper, 'Android');

    expect(wrapper.find('[data-testid="mobile-needs-https"]').exists()).toBe(false);
  });
});
