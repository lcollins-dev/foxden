<template>
  <ui-page>
    <ui-page-heading
      title="Devices"
      subtitle="Browsers signed in to your account. Sign out any you don't recognise or no longer use."
    >
      <ui-button v-if="hasOtherSessions" @click="doSignOutOthers">
        <template #icon>
          <icon-logout class="size-4" aria-hidden="true" />
        </template>
        Sign Out All Others
      </ui-button>
    </ui-page-heading>

    <ui-card
      flush
      title="Firefox"
      subtitle="Signed in to Firefox Sync. Signing one out stops it syncing until you sign in again."
      data-testid="firefox-devices"
    >
      <ui-list-row v-for="row of firefoxRows" :key="row.id" :title="row.name" :meta="row.meta" data-testid="device-row">
        <template #icon><component :is="row.icon" class="size-5" aria-hidden="true" /></template>

        <template #tags>
          <ui-tag v-if="row.current" type="success">This device</ui-tag>
        </template>

        <template #actions>
          <ui-button v-if="!row.current" type="text" @click="doSignOut(row)">
            <template #icon>
              <icon-logout class="size-4" aria-hidden="true" />
            </template>
            Sign out
          </ui-button>
        </template>
      </ui-list-row>

      <ui-empty v-if="loaded && firefoxRows.length === 0">
        No Firefox browsers are signed in. Follow <ui-link to="/getting-started">Getting started</ui-link> to add one.
      </ui-empty>
    </ui-card>

    <ui-card flush title="Web sessions" subtitle="Places you're signed in to this site." data-testid="web-sessions">
      <ui-list-row v-for="row of webRows" :key="row.id" :title="row.name" :meta="row.meta" data-testid="session-row">
        <template #icon><component :is="row.icon" class="size-5" aria-hidden="true" /></template>

        <template #tags>
          <ui-tag v-if="row.current" type="success">This device</ui-tag>
        </template>

        <template #actions>
          <ui-button v-if="!row.current" type="text" @click="doSignOut(row)">
            <template #icon>
              <icon-logout class="size-4" aria-hidden="true" />
            </template>
            Sign out
          </ui-button>
        </template>
      </ui-list-row>
    </ui-card>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import IconLogout from '~icons/material-symbols/logout-rounded';

import type { AccountSessionDto } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { type ISessionRow, toSessionRow } from '@/utils/sessionRow';

import { useLogService } from '@/services/LogService';
import { useAccountSessionService } from '@/services/api/AccountSessionService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import { UiButton, UiCard, UiEmpty, UiLink, UiListRow, UiPage, UiPageHeading, UiTag } from '@/components/ui';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/Devices');

const accountSessionService = useAccountSessionService();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();

const sessions = ref<AccountSessionDto[]>([]);
const loaded = ref(false);

const rows = computed(() => sessions.value.map(session => toSessionRow(session)));
const firefoxRows = computed(() => rows.value.filter(row => row.firefox));
const webRows = computed(() => rows.value.filter(row => !row.firefox));
const hasOtherSessions = computed(() => rows.value.some(row => !row.current));

const doGetSessions = () => {
  accountSessionService
    .getSessionList()
    .then(response => {
      sessions.value = response.sessionList;
    })
    .finally(() => {
      loaded.value = true;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetSessions(): Failed to list the sessions');
    });
};

const doSignOut = (row: ISessionRow) => {
  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Sign out ${row.name}?`,
    message: row.firefox
      ? 'It stops syncing until you sign in to Firefox Sync on it again.'
      : "It's signed out of this site and has to sign in again.",
    confirmLabel: 'Sign Out',
    action: async () => {
      await accountSessionService.signOutSession(row.id);
      sessions.value = sessions.value.filter(session => session.id !== row.id);

      if (row.firefox) {
        notificationStore.addToast('Firefox signed out', `${row.name} will stop syncing until you sign in again.`);
      } else {
        notificationStore.addToast('Session signed out', `${row.name} has been signed out of this site.`);
      }
    },
  });
};

const doSignOutOthers = () => {
  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: 'Sign out all other devices?',
    message:
      'Every other browser stops syncing, and every other session of this site is signed out, until each signs ' +
      'in again. This one stays signed in.',
    confirmLabel: 'Sign Out All Others',
    action: async () => {
      const { signedOut } = await accountSessionService.signOutOthers();
      sessions.value = sessions.value.filter(session => session.current);
      notificationStore.addToast(
        'Signed out everywhere else',
        `${signedOut} ${signedOut === 1 ? 'device was' : 'devices were'} signed out.`
      );
    },
  });
};

onMounted(doGetSessions);
</script>
