import { RouteRecordRaw, RouteRecordRedirectOption } from 'vue-router';

import { HOME_PATH } from './middleware/auth';

// A string redirect keeps the query.
const redirectDroppingQuery = (path: string): RouteRecordRedirectOption => {
  return () => ({ path, query: {}, hash: '' });
};

export const firefoxRoutes: RouteRecordRaw[] = [
  {
    // Firefox opens the root with its OAuth params (FxAccountsConfig.sys.mjs `_buildURL`).
    path: '/',
    redirect: to => ('context' in to.query ? { path: '/firefox/sign-in', query: to.query } : HOME_PATH),
  },
  {
    // Firefox for Android and iOS open the OpenID `authorization_endpoint` (fxa-client internal/oauth.rs).
    path: '/authorization',
    redirect: to => ({ path: '/firefox/sign-in', query: to.query }),
  },
  {
    // Where Firefox for Android and iOS sign in again to an account whose session they lost.
    path: '/oauth/force_auth',
    redirect: to => ({ path: '/firefox/sign-in', query: to.query }),
  },
  {
    // Firefox's "Manage account" (FxAccountsConfig.sys.mjs).
    path: '/settings',
    redirect: redirectDroppingQuery('/profile-and-security'),
  },
  {
    // Firefox's "Manage devices".
    path: '/settings/clients',
    redirect: redirectDroppingQuery('/devices'),
  },
  {
    // Firefox's "Change avatar".
    path: '/settings/avatar/change',
    redirect: redirectDroppingQuery('/profile-and-security'),
  },
  {
    // Firefox's set-password page after a third-party sign-in.
    path: '/post_verify/third_party_auth/set_password',
    redirect: redirectDroppingQuery('/profile-and-security'),
  },
  {
    // Firefox's "Connect another device".
    path: '/connect_another_device',
    redirect: redirectDroppingQuery(HOME_PATH),
  },
];
