<template>
  <ui-page>
    <ui-page-heading title="Profile &amp; security" subtitle="Your name, email and password." />

    <ui-form @submit="doSaveProfile">
      <ui-card title="Profile" subtitle="How you appear and the email you sign in with.">
        <ui-form-field
          v-slot="{ input }"
          layout="row"
          label="Display name"
          help="Shown in the header and to your admin."
          path="name"
        >
          <ui-input
            v-model:value="name"
            v-bind="input"
            name="display-name"
            placeholder="Your name"
            :disabled="profileBusy"
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
            autocomplete="email"
            name="email"
            :disabled="profileBusy"
          />
        </ui-form-field>

        <ui-form-field
          v-if="emailChanged"
          v-slot="{ input }"
          layout="row"
          label="Current password"
          help="Needed to change your email."
          path="authPw"
          :error="emailPasswordError"
        >
          <ui-input
            v-model:value="emailPassword"
            type="password"
            v-bind="input"
            autocomplete="current-password"
            name="email-password"
            placeholder="Current password"
            :disabled="profileBusy"
          />
        </ui-form-field>

        <template #footer>
          <ui-button type="primary" native-type="submit" :disabled="profileUnchanged" :loading="profileBusy">
            Save
          </ui-button>
        </template>
      </ui-card>
    </ui-form>

    <ui-form @submit="doChangePassword">
      <ui-card
        title="Password"
        subtitle="Changing it signs out your other devices. You'll need to sign in to Firefox Sync again on each one."
      >
        <ui-form-field
          v-slot="{ input }"
          layout="row"
          label="Current password"
          path="password"
          :error="passwordErrors.current"
        >
          <ui-input
            v-model:value="currentPassword"
            type="password"
            v-bind="input"
            autocomplete="current-password"
            name="current-password"
            placeholder="Current password"
            :disabled="passwordBusy"
          />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          layout="row"
          label="New password"
          :help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
          :error="passwordErrors.newPassword"
        >
          <ui-input
            v-model:value="newPassword"
            type="password"
            v-bind="input"
            autocomplete="new-password"
            name="new-password"
            placeholder="New password"
            :disabled="passwordBusy"
          />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          layout="row"
          label="Confirm new password"
          :error="passwordErrors.confirmPassword"
        >
          <ui-input
            v-model:value="confirmPassword"
            type="password"
            v-bind="input"
            autocomplete="new-password"
            name="confirm-password"
            placeholder="Enter it again"
            :disabled="passwordBusy"
          />
        </ui-form-field>

        <template #footer>
          <ui-button type="primary" native-type="submit" :loading="passwordBusy">Change Password</ui-button>
        </template>
      </ui-card>
    </ui-form>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { DialogType } from '@/types/dialog';

import { MIN_PASSWORD_LENGTH, newPasswordErrors } from '@/utils/newPasswordError';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { UiButton, UiCard, UiForm, UiFormField, UiInput, UiPage, UiPageHeading } from '@/components/ui';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/AccountSettings');

const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userService = useUserService();

const name = ref('');
const email = ref('');
const emailPassword = ref('');
const profileBusy = ref(false);
const emailPasswordError = ref('');

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passwordBusy = ref(false);
const passwordErrors = reactive({ current: '', newPassword: '', confirmPassword: '' });

const nameChanged = computed(() => name.value.trim() !== (userStore.profile?.name ?? ''));
const emailChanged = computed(
  () => email.value.trim().toLowerCase() !== (userStore.profile?.email ?? '').toLowerCase()
);
const profileUnchanged = computed(() => !nameChanged.value && !emailChanged.value);

// Filled once per account: a profile reload between the name and the email change must not undo the typed address.
watch(
  () => userStore.profile?.uid,
  () => {
    name.value = userStore.profile?.name ?? '';
    email.value = userStore.profile?.email ?? '';
  },
  { immediate: true }
);

watch([email, emailPassword], () => {
  emailPasswordError.value = '';
});

watch([currentPassword, newPassword, confirmPassword], () => {
  passwordErrors.current = '';
  passwordErrors.newPassword = '';
  passwordErrors.confirmPassword = '';
});

const saveProfile = async () => {
  if (nameChanged.value) {
    await userService.updateProfile({ name: name.value.trim() });
  }

  if (emailChanged.value) {
    await userService.changeEmail(email.value.trim(), emailPassword.value);
    emailPassword.value = '';
  }

  notificationStore.addToast('Profile updated', 'Your changes have been saved.');
};

const doSaveProfile = () => {
  if (profileBusy.value) {
    return;
  }

  if (emailChanged.value && emailPassword.value === '') {
    emailPasswordError.value = 'Enter your current password.';
    return;
  }

  profileBusy.value = true;

  saveProfile()
    .finally(() => {
      profileBusy.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSaveProfile(): Failed to save the profile');
    });
};

const doChangePassword = () => {
  if (passwordBusy.value) {
    return;
  }

  passwordErrors.current = currentPassword.value === '' ? 'Enter your current password.' : '';
  Object.assign(passwordErrors, newPasswordErrors(newPassword.value, confirmPassword.value, currentPassword.value));

  if (passwordErrors.current !== '' || passwordErrors.newPassword !== '' || passwordErrors.confirmPassword !== '') {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: 'Change your password?',
    message: 'Every other device, Firefox included, is signed out and has to sign in to Firefox Sync again.',
    confirmLabel: 'Change Password',
    action: async () => {
      passwordBusy.value = true;

      try {
        await userService.changePassword(currentPassword.value, newPassword.value);
      } finally {
        passwordBusy.value = false;
      }

      currentPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
      notificationStore.addToast('Password changed', 'Sign in to Firefox Sync again on your other devices.');
    },
  });
};
</script>
