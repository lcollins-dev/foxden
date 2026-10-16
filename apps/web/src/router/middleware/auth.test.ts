import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { RouteLocationNormalized } from 'vue-router';

import { useUserStore } from '@/stores/user';

import { authMiddleware } from './auth';

const routerMock = vi.hoisted(() => ({ replace: vi.fn(() => Promise.resolve()) }));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => routerMock,
}));

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ getProfile: vi.fn(() => Promise.resolve()) }),
}));

const signedInRoute = (fullPath: string): RouteLocationNormalized =>
  ({ path: fullPath.split('?')[0], fullPath, query: {}, hash: '', meta: { requiresAuthState: 'loggedin' } }) as never;

const signInRoute = (redirect: string): RouteLocationNormalized =>
  ({ path: '/sign-in', query: { redirect }, hash: '', meta: { requiresAuthState: 'loggedout' } }) as never;

const runAuthMiddleware = (to: RouteLocationNormalized) => authMiddleware.call(undefined, to, to, () => undefined);

describe('authMiddleware', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routerMock.replace.mockClear();
  });

  it('sends a signed-out visitor to sign in, carrying the page they asked for', async () => {
    expect(await runAuthMiddleware(signedInRoute('/admin/users?page=2'))).toEqual({
      path: '/sign-in',
      query: { redirect: '/admin/users?page=2' },
    });
  });

  it('sends a signed-out visitor to a plain sign in from the home page', async () => {
    expect(await runAuthMiddleware(signedInRoute('/getting-started'))).toEqual({ path: '/sign-in', query: {} });
  });

  it('sends a signed-in visitor on sign-in to the page it carries', async () => {
    useUserStore().setToken('token');

    expect(await runAuthMiddleware(signInRoute('/devices'))).toBe('/devices');
  });

  it('sends a signed-in visitor on sign-in home when the page it carries leaves this origin', async () => {
    useUserStore().setToken('token');

    expect(await runAuthMiddleware(signInRoute('//evil.example/devices'))).toBe('/getting-started');
  });

  it('sends a visitor signed out while on a page to a plain sign in', async () => {
    useUserStore().setToken('token');

    expect(await runAuthMiddleware(signedInRoute('/admin/users'))).toBeUndefined();

    useUserStore().setToken(null);
    await nextTick();

    expect(routerMock.replace).toHaveBeenCalledWith({ path: '/sign-in', query: {} });
  });

  it('sends a visitor whose session ended while on a page to sign in, carrying that page', async () => {
    useUserStore().setToken('token');

    expect(await runAuthMiddleware(signedInRoute('/admin/users?page=2'))).toBeUndefined();

    useUserStore().endSession();
    await nextTick();

    expect(routerMock.replace).toHaveBeenCalledWith({ path: '/sign-in', query: { redirect: '/admin/users?page=2' } });
  });
});
