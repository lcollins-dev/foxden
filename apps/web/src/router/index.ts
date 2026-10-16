/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw, createRouter, createWebHistory } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import { Layout } from '@/components/layouts';

import Error from '@/pages/Error.vue';
import Invite from '@/pages/Invite.vue';
import PageNotFound from '@/pages/PageNotFound.vue';
import ResetPassword from '@/pages/ResetPassword.vue';
import FirefoxSignIn from '@/pages/firefox/SignIn.vue';

import { firefoxRoutes } from './firefox';
import { loggedInRoutes } from './loggedin';
import { loggedOutRoutes } from './loggedout';
import { authMiddleware, NOT_FOUND_ROUTE } from './middleware/auth';
import { clearNotificationsErrorMiddleware } from './middleware/clear-notifications-errors';
import { logMiddleware } from './middleware/log';

declare module 'vue-router' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface RouteMeta {
    layout?: Layout;
    requiresAuthState?: 'loggedin' | 'loggedout';
    requiresRoleId?: UserRoleId[] | UserRoleId;
    hideSider?: boolean;
    hideAccountMenu?: boolean;
  }
}

const routes: Readonly<RouteRecordRaw[]> = [
  // Logged out
  ...loggedOutRoutes.map(route => {
    route.meta = route.meta ?? {};
    route.meta.requiresAuthState = 'loggedout';

    return route;
  }),
  ...loggedInRoutes.map(route => {
    route.meta = route.meta ?? {};
    route.meta.requiresAuthState = 'loggedin';

    return route;
  }),
  ...firefoxRoutes,
  {
    path: '/firefox/sign-in',
    component: FirefoxSignIn,
    meta: {
      layout: Layout.MINIMAL,
    },
  },
  {
    path: '/invite/:token',
    component: Invite,
    meta: {
      hideSider: true,
      hideAccountMenu: true,
    },
  },
  {
    path: '/reset-password/:token',
    component: ResetPassword,
    meta: {
      hideSider: true,
      hideAccountMenu: true,
    },
  },
  {
    path: '/error',
    component: Error,
  },
  {
    path: '/:pathMatch(.*)*',
    name: NOT_FOUND_ROUTE,
    component: PageNotFound,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(logMiddleware);
router.beforeEach(clearNotificationsErrorMiddleware);
router.beforeEach(authMiddleware);

export { router };
