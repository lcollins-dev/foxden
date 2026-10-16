<template>
  <ui-dropdown v-model:open="open" @keydown.tab="open = false">
    <template #trigger="{ open: isOpen, toggle, panelId }">
      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-transparent pl-1 pr-2 text-sm text-highlight outline-hidden hover:bg-inset focus-visible:bg-inset"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        :aria-controls="isOpen ? panelId : undefined"
        data-testid="user-menu"
        @click="toggle"
      >
        <ui-avatar size="sm" round>{{ initial }}</ui-avatar>
        <span>{{ label }}</span>
        <icon-expand-more class="size-4 text-muted" aria-hidden="true" />
      </button>
    </template>

    <ui-menu :title="label" :subtitle="userStore.profile?.email" :items="MENU_ITEMS" @select="onSelect" />
  </ui-dropdown>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';
import IconLogout from '~icons/material-symbols/logout-rounded';
import IconManageAccounts from '~icons/material-symbols/manage-accounts-outline-rounded';

import { accountInitial, accountLabel } from '@/utils/accountLabel';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { IMenuItem, UiAvatar, UiDropdown, UiMenu } from '@/components/ui';

const MENU_ITEMS: IMenuItem[] = [
  { key: 'account', label: 'Profile & security', icon: IconManageAccounts },
  { key: 'sign-out', label: 'Sign out', icon: IconLogout },
];

const logService = useLogService();
const logger = logService.createLogger('components/UserMenu');

const router = useRouter();

const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userService = useUserService();

const open = ref(false);

const label = computed(() => accountLabel(userStore.profile?.name ?? '', userStore.profile?.email ?? ''));
const initial = computed(() => accountInitial(userStore.profile?.name ?? '', userStore.profile?.email ?? ''));

const goToAccount = () => {
  router.push('/profile-and-security').catch((error: unknown) => {
    logger.error({ error }, 'goToAccount(): Failed to navigate');
  });
};

const doSignOut = () => {
  userService
    .logout()
    .then(async () => {
      await router.push('/sign-in');
      notificationStore.addToast('Signed out', 'Firefox stays signed in and keeps syncing.');
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSignOut(): Sign out failed');
    });
};

const onSelect = (key: string) => {
  open.value = false;

  if (key === 'account') {
    goToAccount();
  } else if (key === 'sign-out') {
    doSignOut();
  }
};
</script>
