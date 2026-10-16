/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import AdminInvites from '@/pages/loggedin/admin/invites/Index.vue';
import AdminJobs from '@/pages/loggedin/admin/jobs/Index.vue';
import AdminJob from '@/pages/loggedin/admin/jobs/Job.vue';
import AdminUsers from '@/pages/loggedin/admin/users/Index.vue';
import AdminUser from '@/pages/loggedin/admin/users/User.vue';

export const adminRoutes: RouteRecordRaw[] = [
  {
    path: 'users',
    meta: {
      requiresRoleId: UserRoleId.USER_ADMIN,
    },
    children: [
      {
        path: '',
        component: AdminUsers,
      },
      {
        path: ':userId(\\d+)',
        component: AdminUser,
      },
    ],
  },
  {
    path: 'invites',
    component: AdminInvites,
    meta: {
      requiresRoleId: UserRoleId.USER_ADMIN,
    },
  },
  {
    path: 'jobs',
    meta: {
      requiresRoleId: UserRoleId.SYSTEM_ADMIN,
    },
    children: [
      {
        path: '',
        component: AdminJobs,
      },
      {
        path: ':batchJobId(\\d+)',
        component: AdminJob,
      },
    ],
  },
];
