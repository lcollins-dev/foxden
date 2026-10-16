<template>
  <ui-page wide>
    <ui-page-heading title="Users" subtitle="Everyone with an account on this server.">
      <ui-button type="primary" to="/admin/invites">
        <template #icon>
          <icon-add class="size-4" aria-hidden="true" />
        </template>
        Invite User
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-divider px-4 py-3">
        <div class="max-w-xs shrink grow basis-56">
          <ui-input
            v-model:value="search"
            placeholder="Search name or email"
            aria-label="Search name or email"
            clearable
          />
        </div>

        <div class="grow"></div>

        <ui-segmented v-model:value="role" :options="ROLE_OPTIONS" />
        <ui-segmented v-model:value="status" :options="STATUS_OPTIONS" />
      </div>

      <ui-table :columns="TABLE_COLUMNS">
        <ui-table-head>
          <span>Account</span>
          <span>Access</span>
          <span>Created</span>
          <span>Last active</span>
          <span></span>
        </ui-table-head>

        <ui-table-row v-for="user of userList" :key="user.id" :to="`/admin/users/${user.id}`" data-testid="user-row">
          <div class="flex min-w-0 items-center gap-3">
            <ui-avatar round :type="user.enabled ? 'primary' : 'gray'">
              {{ accountInitial(user.name, user.email) }}
            </ui-avatar>
            <div class="min-w-0">
              <div class="truncate font-medium text-header">{{ accountLabel(user.name, user.email) }}</div>
              <div class="truncate text-xs text-muted">{{ user.email }}</div>
            </div>
          </div>

          <div class="flex gap-1.5">
            <ui-tag :type="isAdmin(user) ? 'primary' : 'default'">
              {{ isAdmin(user) ? 'Admin' : 'User' }}
            </ui-tag>
            <ui-tag :type="user.enabled ? 'success' : 'error'">
              {{ user.enabled ? 'Enabled' : 'Disabled' }}
            </ui-tag>
          </div>

          <span class="text-xs">{{ formatDay(new Date(user.createdDate)) }}</span>
          <span class="text-xs">{{
            user.lastActiveAt === null ? 'Never' : formatDay(new Date(user.lastActiveAt))
          }}</span>

          <icon-chevron-right class="size-4 text-muted" aria-hidden="true" />
        </ui-table-row>
      </ui-table>

      <ui-empty v-if="loaded && userList.length === 0">No accounts match your search.</ui-empty>

      <div class="flex items-center justify-between gap-3 border-t border-divider px-4 py-2.5 text-xs text-muted">
        <span data-testid="user-count">Showing {{ total }} of {{ allAccounts }} accounts</span>
        <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
      </div>
    </ui-card>
  </ui-page>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { ref, watch } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { ListUserDto } from '@libs/dto';
import { UserListRole, UserListStatus, UserRoleId } from '@libs/dto';

import { Config } from '@/Config';

import { accountInitial, accountLabel } from '@/utils/accountLabel';
import { formatDay } from '@/utils/date';

import { useLogService } from '@/services/LogService';
import { useUserAdminService } from '@/services/api/admin/UserAdminService';

import {
  type ISegmentedOption,
  UiAvatar,
  UiButton,
  UiCard,
  UiEmpty,
  UiInput,
  UiPage,
  UiPageHeading,
  UiPagination,
  UiSegmented,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

const TABLE_COLUMNS = 'minmax(0, 1fr) 9rem 7rem 7rem 1.25rem';

const ROLE_OPTIONS: ISegmentedOption<UserListRole>[] = [
  { value: UserListRole.ALL, label: 'All roles' },
  { value: UserListRole.ADMIN, label: 'Admin' },
  { value: UserListRole.USER, label: 'User' },
];

const STATUS_OPTIONS: ISegmentedOption<UserListStatus>[] = [
  { value: UserListStatus.ALL, label: 'Any state' },
  { value: UserListStatus.ENABLED, label: 'Enabled' },
  { value: UserListStatus.DISABLED, label: 'Disabled' },
];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/admin/users/Index');

const userAdminService = useUserAdminService();

const search = ref('');
const role = ref(UserListRole.ALL);
const status = ref(UserListStatus.ALL);
const page = ref(1);

const userList = ref<ListUserDto[]>([]);
const pages = ref(1);
const total = ref(0);
const allAccounts = ref(0);
const loaded = ref(false);

const isAdmin = (user: ListUserDto): boolean =>
  user.userRoleIds.includes(UserRoleId.USER_ADMIN) || user.userRoleIds.includes(UserRoleId.SYSTEM_ADMIN);

const doGetList = () => {
  userAdminService
    .getUserList({ search: search.value.trim(), status: status.value, role: role.value }, page.value)
    .then(response => {
      userList.value = response.userList;
      pages.value = Math.max(response.pages, 1);
      total.value = response.total;
    })
    .finally(() => {
      loaded.value = true;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetList(): Failed to list the users');
    });
};

const doGetStats = () => {
  userAdminService
    .getUserStats()
    .then(stats => {
      allAccounts.value = stats.total;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetStats(): Failed to read the user stats');
    });
};

const debouncedGetList = useDebounceFn(doGetList, Config.LIST_DEBOUNCE_MS);

watch([search, role, status], () => {
  page.value = 1;

  debouncedGetList().catch((error: unknown) => {
    logger.error({ error }, 'watch(): Failed to list the users');
  });
});

watch(page, doGetList);

doGetList();
doGetStats();
</script>
