<template>
  <div class="flex min-h-screen flex-col">
    <header
      class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-divider bg-surface pl-3.5 pr-3"
    >
      <button
        v-if="showMenuButton"
        type="button"
        class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg hover:bg-inset hover:text-highlight text-highlight"
        aria-label="Menu"
        aria-controls="side-menu"
        :aria-expanded="siderOpen"
        @click="toggleSider"
      >
        <icon-menu class="size-5" aria-hidden="true" />
      </button>

      <ui-link
        class="flex items-center gap-2 px-1 py-1.5 text-base font-semibold text-header hover:text-header"
        to="/"
        :title="Config.VERSION"
        unstyled
      >
        <foxden-logo :size="26" />
        <span>Foxden</span>
      </ui-link>

      <div class="grow"></div>

      <button
        type="button"
        class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg hover:bg-inset hover:text-highlight text-muted"
        aria-label="Toggle theme"
        @click="themeStore.toggleDarkMode"
      >
        <component :is="themeStore.isDarkMode ? IconDarkMode : IconLightMode" class="size-5" aria-hidden="true" />
      </button>

      <user-menu v-if="showAccountMenu" />
    </header>

    <div class="flex flex-1">
      <div
        v-if="showDrawer"
        class="fixed inset-x-0 bottom-0 top-14 z-40 animate-fade-in bg-overlay"
        aria-hidden="true"
        data-testid="sidebar-scrim"
        @click="closeSider"
      ></div>

      <nav
        v-if="showSider"
        id="side-menu"
        class="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-divider bg-surface px-2.5 py-3.5"
        :class="showDrawer ? 'fixed bottom-0 left-0 top-14 z-40' : 'sticky top-14 h-[calc(100vh-3.5rem)] self-start'"
        aria-label="Main"
        :data-testid="showDrawer ? 'sidebar-drawer' : undefined"
      >
        <template v-for="(section, index) of navSections" :key="section.title">
          <div v-if="index > 0" class="h-4 min-h-2" />

          <div class="shrink-0 px-2.5 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wider text-muted">
            {{ section.title }}
          </div>

          <router-link v-for="item of section.items" :key="item.to" :to="item.to" :class="navItemClass(item)">
            <component :is="item.icon" class="size-5" :class="navIconClass(item)" aria-hidden="true" />
            {{ item.label }}
          </router-link>
        </template>
      </nav>

      <main class="flex min-w-0 flex-1 flex-col px-4 pb-6 pt-6 sm:px-7 sm:pt-8">
        <div class="flex-1">
          <slot />
        </div>

        <app-footer class="pt-6" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onKeyStroke, useWindowSize } from '@vueuse/core';
import { type Component, computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import IconDarkMode from '~icons/material-symbols/dark-mode-outline-rounded';
import IconDevices from '~icons/material-symbols/devices-outline-rounded';
import IconGroup from '~icons/material-symbols/group-outline-rounded';
import IconLightMode from '~icons/material-symbols/light-mode-outline-rounded';
import IconMail from '~icons/material-symbols/mail-outline-rounded';
import IconManageAccounts from '~icons/material-symbols/manage-accounts-outline-rounded';
import IconMenu from '~icons/material-symbols/menu-rounded';
import IconRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';
import IconSchedule from '~icons/material-symbols/schedule-outline-rounded';

import { UserRoleId } from '@libs/dto';

import { Config } from '@/Config';

import { useThemeStore } from '@/stores/theme';
import { useUserStore } from '@/stores/user';

import AppFooter from '@/components/AppFooter.vue';
import FoxdenLogo from '@/components/FoxdenLogo.vue';
import UserMenu from '@/components/UserMenu.vue';
import { UiLink } from '@/components/ui';

interface INavItem {
  label: string;
  icon: Component;
  to: string;
}

interface INavSection {
  title: string;
  items: INavItem[];
}

const NARROW_WIDTH = 1024;

const route = useRoute();

const themeStore = useThemeStore();
const userStore = useUserStore();

const { width } = useWindowSize();
const isNarrow = computed(() => width.value < NARROW_WIDTH);
const siderOpen = ref(false);

const signedIn = computed(() => userStore.loggedIn && userStore.profile !== null);

const siderEligible = computed(
  () => signedIn.value && userStore.profile?.mustChangePassword !== true && route.meta.hideSider !== true
);

const showSider = computed(() => siderEligible.value && (!isNarrow.value || siderOpen.value));
const showDrawer = computed(() => showSider.value && isNarrow.value);
const showMenuButton = computed(() => siderEligible.value && isNarrow.value);
const showAccountMenu = computed(() => signedIn.value && route.meta.hideAccountMenu !== true);

const navSections = computed<INavSection[]>(() => [
  {
    title: 'Firefox Sync',
    items: [
      { label: 'Getting started', icon: IconRocketLaunch, to: '/getting-started' },
      { label: 'Devices', icon: IconDevices, to: '/devices' },
    ],
  },
  { title: 'Account', items: [{ label: 'Profile & security', icon: IconManageAccounts, to: '/profile-and-security' }] },
  ...(userStore.hasRole(UserRoleId.USER_ADMIN)
    ? [
        {
          title: 'People',
          items: [
            { label: 'Invites', icon: IconMail, to: '/admin/invites' },
            { label: 'Users', icon: IconGroup, to: '/admin/users' },
          ],
        },
      ]
    : []),
  ...(userStore.hasRole(UserRoleId.SYSTEM_ADMIN)
    ? [{ title: 'Server', items: [{ label: 'Background jobs', icon: IconSchedule, to: '/admin/jobs' }] }]
    : []),
]);

const isActive = (item: INavItem): boolean => route.path === item.to || route.path.startsWith(`${item.to}/`);

const navItemClass = (item: INavItem): string[] => [
  'my-px flex h-9 min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150',
  isActive(item) ? 'bg-emphasis text-header' : 'text-normal hover:bg-inset hover:text-header',
];

const navIconClass = (item: INavItem): string => (isActive(item) ? 'text-accent' : 'text-muted');

const toggleSider = () => {
  siderOpen.value = !siderOpen.value;
};

const closeSider = () => {
  siderOpen.value = false;
};

onKeyStroke('Escape', () => {
  if (siderOpen.value) {
    closeSider();
  }
});

watch([() => route.path, isNarrow], closeSider);
</script>
