<template>
  <ui-page>
    <ui-page-heading v-if="user" :title="accountLabel(user.name, user.email)" back-to="/admin/users" back-label="Users">
      <template #leading>
        <ui-avatar size="lg" round :type="user.enabled ? 'primary' : 'gray'">
          {{ accountInitial(user.name, user.email) }}
        </ui-avatar>
      </template>

      <template #subtitle>
        <span data-testid="user-email">{{ user.email }}</span>
      </template>

      <div class="flex gap-1.5">
        <ui-tag :type="admin ? 'primary' : 'default'">{{ admin ? 'Admin' : 'User' }}</ui-tag>
        <ui-tag :type="user.enabled ? 'success' : 'error'" data-testid="user-state">
          {{ user.enabled ? 'Enabled' : 'Disabled' }}
        </ui-tag>
      </div>
    </ui-page-heading>

    <ui-back-link v-else to="/admin/users" label="Users" />

    <template v-if="user">
      <ui-notice v-if="isSelf" type="info" title="This is your account">
        Change your name and email in <ui-link to="/profile-and-security">Profile &amp; security</ui-link>.
      </ui-notice>

      <ui-card v-else tag="form" title="Profile" @submit.prevent="doSaveProfile">
        <ui-form-field v-slot="{ input }" layout="row" label="Display name" help="Shown in their header." path="name">
          <ui-input
            v-model:value="name"
            v-bind="input"
            name="display-name"
            placeholder="Their name"
            :disabled="pending === 'profile'"
          />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          layout="row"
          label="Email"
          help="Used to sign in here and in Firefox."
          path="email"
        >
          <ui-input
            v-model:value="email"
            v-bind="input"
            type="email"
            autocomplete="off"
            name="email"
            :disabled="pending === 'profile'"
          />
        </ui-form-field>

        <template #footer>
          <ui-button
            type="primary"
            native-type="submit"
            :disabled="!profileChanged || blockedBy('profile')"
            :loading="pending === 'profile'"
          >
            Save
          </ui-button>
        </template>
      </ui-card>

      <ui-card title="Details">
        <ui-stat-grid>
          <ui-stat label="Created">{{ formatDay(new Date(user.createdDate)) }}</ui-stat>
          <ui-stat label="Last active">
            {{ user.lastActiveAt === null ? 'Never' : formatDay(new Date(user.lastActiveAt)) }}
          </ui-stat>
        </ui-stat-grid>
      </ui-card>

      <ui-card flush title="Access" :subtitle="accessDescription">
        <div class="divide-y divide-divider px-6">
          <setting-row title="Role">
            <template #help>Admins can invite people, manage accounts and run background jobs.</template>

            <ui-segmented
              :value="admin ? 'admin' : 'user'"
              :options="ROLE_OPTIONS"
              :disabled="isSelf || busy"
              @update:value="doChangeRole"
            />
          </setting-row>

          <setting-row :title="user.enabled ? 'Disable account' : 'Enable account'">
            <template #help>
              {{
                user.enabled
                  ? 'Signs them out everywhere and stops their sync. Their data is kept, so you can enable them again later.'
                  : "They can't sign in or sync. Their data is still stored. Enable the account to let them back in."
              }}
            </template>

            <ui-button :disabled="isSelf || blockedBy('state')" :loading="pending === 'state'" @click="doToggleEnabled">
              {{ user.enabled ? 'Disable' : 'Enable' }}
            </ui-button>
          </setting-row>

          <setting-row title="Reset password" data-testid="password-reset-row">
            <template #help>{{ passwordResetHelp }}</template>

            <ui-button
              :disabled="isSelf || blockedBy('reset')"
              :loading="pending === 'reset'"
              @click="doCreatePasswordReset"
            >
              {{ user.passwordResetExpiresAt === null ? 'Create Reset Link' : 'New Link' }}
            </ui-button>
          </setting-row>
        </div>
      </ui-card>

      <ui-card flush danger>
        <div class="px-6">
          <setting-row title="Delete account">
            <template #help>
              Removes the account and everything it has synced: bookmarks, history, passwords, tabs and add-ons. This
              can't be undone.
            </template>

            <ui-button type="danger-outline" :disabled="isSelf || busy" @click="doDelete">Delete Account</ui-button>
          </setting-row>
        </div>
      </ui-card>
    </template>

    <ui-modal
      v-if="user"
      :show="createdReset !== null"
      class="max-w-md"
      :title="`Reset link for ${accountLabel(user.name, user.email)}`"
      data-testid="password-reset-modal"
      @update:show="closeCreatedReset"
    >
      <p class="mb-4 mt-0 leading-normal">
        Pass this link to them. It's shown once and expires
        {{ createdReset === null ? '' : formatDayTime(new Date(createdReset.expiresAt)) }}.
      </p>

      <ui-copy-values class="mb-5">
        <ui-copy-value :value="createdReset?.link ?? ''" value-test-id="password-reset-link" />
      </ui-copy-values>

      <div class="flex justify-end">
        <ui-button type="primary" @click="closeCreatedReset">Done</ui-button>
      </div>
    </ui-modal>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, h, ref, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import type { CreatePasswordResetResponseDto, UserDto } from '@libs/dto';
import { UserRoleId } from '@libs/dto';

import { DialogType, IDialogOptions } from '@/types/dialog';

import { accountInitial, accountLabel } from '@/utils/accountLabel';
import { formatDay, formatDayTime } from '@/utils/date';

import { useLogService } from '@/services/LogService';
import { useUserAdminService } from '@/services/api/admin/UserAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import SettingRow from '@/components/SettingRow.vue';
import {
  type ISegmentedOption,
  UiAvatar,
  UiBackLink,
  UiButton,
  UiCard,
  UiCopyValue,
  UiCopyValues,
  UiFormField,
  UiInput,
  UiLink,
  UiModal,
  UiNotice,
  UiPage,
  UiPageHeading,
  UiSegmented,
  UiStat,
  UiStatGrid,
  UiTag,
} from '@/components/ui';

type Role = 'user' | 'admin';
type Action = 'profile' | 'role' | 'state' | 'reset' | 'delete';

const ROLE_OPTIONS: ISegmentedOption<Role>[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

const ADMIN_ROLE_IDS: number[] = [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/admin/users/User');

const route = useRoute();
const router = useRouter();

const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userAdminService = useUserAdminService();

const userId = computed(() => (typeof route.params.userId === 'string' ? parseInt(route.params.userId, 10) : null));

const user = ref<UserDto | null>(null);
const name = ref('');
const email = ref('');
const createdReset = ref<CreatePasswordResetResponseDto | null>(null);

// One action at a time, so each request is built from the user the previous one reloaded.
const pending = ref<Action | null>(null);
const busy = computed(() => pending.value !== null);

const admin = computed(() => user.value?.userRoleIds.some(roleId => ADMIN_ROLE_IDS.includes(roleId)) === true);

const isSelf = computed(() => user.value !== null && user.value.uid === userStore.profile?.uid);

const profileChanged = computed(
  () => user.value !== null && (name.value.trim() !== user.value.name || email.value.trim() !== user.value.email)
);
const label = computed(() => (user.value === null ? '' : accountLabel(user.value.name, user.value.email)));

const accessDescription = computed(() =>
  isSelf.value
    ? 'This is your account. Another admin has to change your role, disable or delete it.'
    : 'What this person can do on the server.'
);

const passwordResetHelp = computed(() => {
  if (user.value === null) {
    return '';
  }

  if (isSelf.value) {
    return 'Change your own password in Profile & security.';
  }

  if (user.value.passwordResetExpiresAt !== null) {
    return `A reset link is waiting to be used. It expires ${formatDayTime(new Date(user.value.passwordResetExpiresAt))}.`;
  }

  return "For a forgotten password. Gives them a new sync key: what's stored only here is lost, and each Firefox signs in again and uploads its data.";
});

const blockedBy = (action: Action) => busy.value && pending.value !== action;

const fillProfile = () => {
  name.value = user.value?.name ?? '';
  email.value = user.value?.email ?? '';
};

// Filled once per user, so a reload after a role or state change keeps unsaved edits.
watch(() => user.value?.id, fillProfile, { immediate: true });

const loadUser = async () => {
  if (userId.value === null) {
    return;
  }

  try {
    user.value = await userAdminService.getUser(userId.value);
  } catch (error) {
    logger.error({ error }, 'loadUser(): Failed to read the user');
  }
};

const runAction = (action: Action, request: () => Promise<void>, failure: string) => {
  pending.value = action;

  request()
    .finally(() => {
      pending.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, failure);
    });
};

// The dialog's action holds the one pending action, so the page's other buttons wait for it.
const confirmAction = (action: Action, options: Omit<IDialogOptions, 'action'>, request: () => Promise<void>) => {
  void dialogStore.confirm({
    ...options,
    action: async () => {
      pending.value = action;

      try {
        await request();
      } finally {
        pending.value = null;
      }
    },
  });
};

const doGetUser = () => {
  loadUser().catch((error: unknown) => {
    logger.error({ error }, 'doGetUser(): Failed to read the user');
  });
};

const doChangeRole = (role: Role) => {
  if (user.value === null || busy.value || role === (admin.value ? 'admin' : 'user')) {
    return;
  }

  const target = user.value;
  const makeAdmin = role === 'admin';
  const userRoleIds = makeAdmin ? ADMIN_ROLE_IDS : [];

  confirmAction(
    'role',
    makeAdmin
      ? {
          type: DialogType.INFO,
          title: `Make ${label.value} an admin?`,
          message: 'Admins can invite people, manage accounts and run background jobs.',
          confirmLabel: 'Make Admin',
        }
      : {
          type: DialogType.WARNING,
          title: `Remove admin from ${label.value}?`,
          message: 'They keep their account and synced data, but can no longer manage this server.',
          confirmLabel: 'Remove Admin',
        },
    async () => {
      await userAdminService.updateUser({ name: target.name, email: target.email, userRoleIds }, target.id);
      notificationStore.addToast('Role changed', `${label.value} is now ${makeAdmin ? 'an admin' : 'a user'}.`);
      await loadUser();
    }
  );
};

const doSaveProfile = () => {
  if (user.value === null || isSelf.value || busy.value || !profileChanged.value) {
    return;
  }

  const target = user.value;
  const updateUserRequest = { name: name.value.trim(), email: email.value.trim(), userRoleIds: target.userRoleIds };

  runAction(
    'profile',
    async () => {
      await userAdminService.updateUser(updateUserRequest, target.id);
      notificationStore.addToast('Profile updated', 'Their changes have been saved.');
      await loadUser();
      fillProfile();
    },
    'doSaveProfile(): Failed to update the profile'
  );
};

const doToggleEnabled = () => {
  if (user.value === null || busy.value) {
    return;
  }

  const target = user.value;

  if (!target.enabled) {
    runAction(
      'state',
      async () => {
        await userAdminService.updateState({ enabled: true }, target.id);
        notificationStore.addToast('Account enabled', `${label.value} can sign in again.`);
        await loadUser();
      },
      'doToggleEnabled(): Failed to enable the account'
    );
    return;
  }

  confirmAction(
    'state',
    {
      type: DialogType.WARNING,
      title: `Disable ${label.value}?`,
      message: "They're signed out everywhere, and Firefox stops syncing until you enable the account again.",
      confirmLabel: 'Disable Account',
    },
    async () => {
      await userAdminService.updateState({ enabled: false }, target.id);
      notificationStore.addToast('Account disabled', `${label.value} has been signed out everywhere.`);
      await loadUser();
    }
  );
};

const doCreatePasswordReset = () => {
  if (user.value === null || isSelf.value || busy.value) {
    return;
  }

  const target = user.value;

  const createReset = async () => {
    createdReset.value = await userAdminService.createPasswordReset(target.id);
    await loadUser();
  };

  if (target.passwordResetExpiresAt === null) {
    runAction('reset', createReset, 'doCreatePasswordReset(): Failed to create the reset link');
    return;
  }

  confirmAction(
    'reset',
    {
      type: DialogType.WARNING,
      title: `Replace the reset link for ${label.value}?`,
      message: 'The link you made before stops working.',
      confirmLabel: 'New Link',
    },
    createReset
  );
};

const closeCreatedReset = () => {
  createdReset.value = null;
};

const doDelete = () => {
  if (user.value === null || busy.value) {
    return;
  }

  const target = user.value;

  confirmAction(
    'delete',
    {
      type: DialogType.DANGER,
      title: `Delete ${accountLabel(target.name, target.email)}?`,
      message: () =>
        h('span', [
          'This deletes ',
          h('span', { class: 'text-highlight' }, target.email),
          " and everything it has synced. Firefox stops syncing on their devices. You can't undo this.",
        ]),
      confirmLabel: 'Delete Account',
      confirmText: target.email,
      confirmTextLabel: 'Type their email to confirm',
    },
    async () => {
      await userAdminService.deleteUser(target.id);
      await router.push('/admin/users');
      notificationStore.addToast('Account deleted', `${target.email} and its synced data were removed.`);
    }
  );
};

watchEffect(doGetUser);
</script>
