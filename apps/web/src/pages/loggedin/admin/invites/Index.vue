<template>
  <ui-page wide>
    <ui-page-heading title="Invites">
      <template #subtitle>
        Accounts are invite-only. Each link works once and expires after {{ lifetimeText }}.
      </template>
    </ui-page-heading>

    <ui-card
      tag="form"
      title="New invite"
      subtitle="Send the link to them yourself, or we'll email it if email is set up."
      @submit.prevent="doCreateInvite"
    >
      <div class="flex flex-wrap gap-x-4">
        <ui-form-field v-slot="{ input }" class="shrink grow basis-56" label="Name" path="name">
          <ui-input
            v-model:value="name"
            v-bind="input"
            name="invite-name"
            autocomplete="off"
            placeholder="Their name"
            :disabled="creating"
          />
        </ui-form-field>

        <ui-form-field v-slot="{ input }" class="shrink grow basis-64" label="Email" path="email">
          <ui-input
            v-model:value="email"
            v-bind="input"
            type="email"
            name="invite-email"
            autocomplete="off"
            placeholder="Their email address"
            :disabled="creating"
          />
        </ui-form-field>

        <div class="mb-5 flex flex-col">
          <ui-form-label class="mb-1" label="Role" />

          <ui-segmented v-model:value="role" :options="ROLE_OPTIONS" aria-label="Role" :disabled="creating" />
        </div>
      </div>

      <div class="flex justify-end">
        <ui-button type="primary" native-type="submit" :loading="creating">Create Invite</ui-button>
      </div>
    </ui-card>

    <ui-card flush title="Pending invites" subtitle="Links that haven't been used yet." data-testid="pending-invites">
      <ui-list-row
        v-for="invite of inviteList"
        :key="invite.id"
        :title="invite.name"
        :meta="inviteMeta(invite)"
        data-testid="pending-invite"
      >
        <template #tags>
          <ui-tag v-if="invite.admin" type="primary">Admin</ui-tag>
        </template>

        <template #actions>
          <ui-button type="danger-outline" @click="doRevoke(invite)">Revoke</ui-button>
        </template>
      </ui-list-row>

      <ui-empty v-if="loaded && inviteList.length === 0">No pending invites</ui-empty>
    </ui-card>

    <ui-modal
      :show="created !== null"
      class="max-w-md"
      :title="`Invite ready for ${created?.name ?? ''}`"
      @update:show="closeCreated"
    >
      <template v-if="created">
        <p class="mb-4 mt-0 leading-normal" data-testid="invite-result">
          Send them this link. It's shown once and expires {{ formatDayTime(new Date(created.expiresAt)) }}.
        </p>

        <ui-copy-values class="mb-4">
          <ui-copy-value :value="created.link" value-test-id="invite-link" />
        </ui-copy-values>

        <div class="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span data-testid="invite-email-status">{{ mailText }}</span>
          <span>Joins as {{ created.admin ? 'admin' : 'user' }}</span>
        </div>

        <div class="flex justify-end">
          <ui-button type="primary" @click="closeCreated">Done</ui-button>
        </div>
      </template>
    </ui-modal>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { PendingInviteDto } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { formatDayTime } from '@/utils/date';

import { useLogService } from '@/services/LogService';
import { useServerService } from '@/services/api/ServerService';
import { useInviteAdminService } from '@/services/api/admin/InviteAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import {
  type ISegmentedOption,
  UiButton,
  UiCard,
  UiCopyValue,
  UiCopyValues,
  UiEmpty,
  UiFormField,
  UiFormLabel,
  UiInput,
  UiListRow,
  UiModal,
  UiPage,
  UiPageHeading,
  UiSegmented,
  UiTag,
} from '@/components/ui';

interface ICreatedInvite {
  name: string;
  email: string;
  admin: boolean;
  link: string;
  expiresAt: string;
  emailSent: boolean;
}

type Role = 'user' | 'admin';

const ROLE_OPTIONS: ISegmentedOption<Role>[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/admin/invites/Index');

const inviteAdminService = useInviteAdminService();
const serverService = useServerService();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();

const name = ref('');
const email = ref('');
const role = ref<Role>('user');
const creating = ref(false);
const created = ref<ICreatedInvite | null>(null);

const inviteList = ref<PendingInviteDto[]>([]);
const emailConfigured = ref(true);
const loaded = ref(false);
const lifetimeDays = ref(7);

const closeCreated = () => {
  created.value = null;
};

const lifetimeText = computed(() => (lifetimeDays.value === 1 ? '1 day' : `${lifetimeDays.value} days`));

const mailText = computed(() => {
  if (created.value === null) {
    return '';
  }

  if (created.value.emailSent) {
    return `Emailed to ${created.value.email}`;
  }

  return emailConfigured.value
    ? "The email couldn't be sent, so send it yourself"
    : "Email isn't set up here, so send it yourself";
});

const inviteMeta = (invite: PendingInviteDto): string =>
  `${invite.email} · Expires ${formatDayTime(new Date(invite.expiresAt))}`;

const doGetInvites = () => {
  inviteAdminService
    .getInviteList()
    .then(response => {
      inviteList.value = response.inviteList;
      emailConfigured.value = response.emailConfigured;
    })
    .finally(() => {
      loaded.value = true;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetInvites(): Failed to list the invites');
    });
};

const doCreateInvite = () => {
  if (creating.value) {
    return;
  }

  const address = email.value.trim().toLowerCase();
  const inviteName = name.value.trim();
  const admin = role.value === 'admin';

  creating.value = true;

  inviteAdminService
    .createInvite({ email: address, name: inviteName, admin })
    .then(response => {
      created.value = { name: inviteName, email: address, admin, ...response };
      name.value = '';
      email.value = '';
      role.value = 'user';
      doGetInvites();
    })
    .finally(() => {
      creating.value = false;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'doCreateInvite(): The invite was refused');
    });
};

const doRevoke = (invite: PendingInviteDto) => {
  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Revoke the invite for ${invite.name}?`,
    message: `The link sent to ${invite.email} stops working at once. To let them join, you'll need to send a new invite.`,
    confirmLabel: 'Revoke',
    action: async () => {
      await inviteAdminService.revokeInvite(invite.id);
      inviteList.value = inviteList.value.filter(pending => pending.id !== invite.id);

      if (created.value?.email === invite.email) {
        created.value = null;
      }

      notificationStore.addToast('Invite revoked', `The link for ${invite.email} no longer works.`);
    },
  });
};

onMounted(() => {
  doGetInvites();

  serverService
    .getServerInfo()
    .then(serverInfo => {
      lifetimeDays.value = Math.round(serverInfo.inviteLifetimeMs / DAY_MS);
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'onMounted(): Failed to read the server info');
    });
});
</script>
