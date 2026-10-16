/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw } from 'vue-router';

import AccountSettings from '@/pages/loggedin/AccountSettings.vue';
import ConnectFirefox from '@/pages/loggedin/ConnectFirefox.vue';
import Devices from '@/pages/loggedin/Devices.vue';
import FirstTimeSetup from '@/pages/loggedin/FirstTimeSetup.vue';

import { adminRoutes } from './admin';

export const loggedInRoutes: RouteRecordRaw[] = [
  {
    path: '/getting-started',
    component: ConnectFirefox,
  },
  {
    path: '/devices',
    component: Devices,
  },
  {
    path: '/profile-and-security',
    component: AccountSettings,
  },
  {
    path: '/setup',
    component: FirstTimeSetup,
    meta: {
      hideSider: true,
    },
  },
  {
    path: '/admin',
    children: adminRoutes,
  },
];
