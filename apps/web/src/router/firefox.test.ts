import { describe, expect, it } from 'vitest';
import { LocationQuery, RouteRecordRaw, createMemoryHistory, createRouter } from 'vue-router';

import { firefoxRoutes } from './firefox';

const SCREENS = ['/getting-started', '/devices', '/profile-and-security', '/firefox/sign-in'];

const landingFor = async (path: string): Promise<{ path: string; query: LocationQuery }> => {
  const screens: RouteRecordRaw[] = SCREENS.map(screen => ({ path: screen, component: { render: () => null } }));

  const router = createRouter({ history: createMemoryHistory(), routes: [...firefoxRoutes, ...screens] });

  await router.push(path);

  const { path: landedPath, query } = router.currentRoute.value;

  return { path: landedPath, query };
};

describe('firefoxRoutes', () => {
  it.each([
    ['/settings', '/profile-and-security'],
    ['/settings/clients', '/devices'],
    ['/settings/avatar/change', '/profile-and-security'],
    ['/post_verify/third_party_auth/set_password', '/profile-and-security'],
    ['/connect_another_device', '/getting-started'],
  ])("sends Firefox's %s to %s without Firefox's query", async (path, screen) => {
    const landing = await landingFor(
      `${path}?entrypoint=preferences&uid=abc&email=sam%40example.com&context=fx_desktop_v3`
    );

    expect(landing).toEqual({ path: screen, query: {} });
  });

  it('sends the root with a context to the Firefox sign-in, keeping the query', async () => {
    expect(await landingFor('/?context=oauth_webchannel_v1&client_id=abc')).toEqual({
      path: '/firefox/sign-in',
      query: { context: 'oauth_webchannel_v1', client_id: 'abc' },
    });
  });

  it('sends the bare root home', async () => {
    expect(await landingFor('/')).toEqual({ path: '/getting-started', query: {} });
  });

  it.each(['/authorization', '/oauth/force_auth'])('sends %s to the Firefox sign-in, keeping the query', async path => {
    expect(await landingFor(`${path}?client_id=abc&email=sam%40example.com`)).toEqual({
      path: '/firefox/sign-in',
      query: { client_id: 'abc', email: 'sam@example.com' },
    });
  });
});
