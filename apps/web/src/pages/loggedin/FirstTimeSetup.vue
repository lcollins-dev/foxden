<template>
  <ui-card class="mx-auto mt-10 max-w-md">
    <form class="m-0" novalidate @submit.prevent="doFinishSetup">
      <ui-form-heading title="Set up your server" />

      <div class="mb-6 mt-4">
        <ui-notice type="warning" title="You're using the default admin account">
          Its password is in the docs, so anyone could use it. Set a new one to continue.
        </ui-notice>
      </div>

      <ui-form-field
        v-slot="{ input }"
        label="Email"
        help="You'll sign in with this. Change it to your own address."
        path="email"
      >
        <ui-input
          v-model:value="email"
          v-bind="input"
          type="email"
          autocomplete="username"
          name="email"
          :disabled="busy"
        />
      </ui-form-field>

      <ui-form-field
        v-slot="{ input }"
        label="New password"
        :help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
        :error="errors.newPassword"
      >
        <ui-input
          v-model:value="newPassword"
          type="password"
          v-bind="input"
          autocomplete="new-password"
          name="new-password"
          placeholder="New password"
          :disabled="busy"
        />
      </ui-form-field>

      <ui-form-field v-slot="{ input }" label="Confirm password" :error="errors.confirmPassword">
        <ui-input
          v-model:value="confirmPassword"
          type="password"
          v-bind="input"
          autocomplete="new-password"
          name="confirm-password"
          placeholder="Enter it again"
          :disabled="busy"
        />
      </ui-form-field>

      <div class="flex justify-between gap-2">
        <ui-button type="text" :disabled="busy" @click="doSignOut">Sign out</ui-button>
        <ui-button type="primary" native-type="submit" :loading="busy">Save and Continue</ui-button>
      </div>

      <p v-if="busy" class="mb-0 mt-2.5 text-center text-xs text-muted">{{ progress }}</p>
    </form>
  </ui-card>
</template>

<script setup lang="ts">
import { reactive, ref, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';

import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';

import { MIN_PASSWORD_LENGTH, newPasswordErrors } from '@/utils/newPasswordError';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { UiButton, UiCard, UiFormField, UiFormHeading, UiInput, UiNotice } from '@/components/ui';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/FirstTimeSetup');

const router = useRouter();

const notificationStore = useNotificationStore();
const userService = useUserService();
const userStore = useUserStore();

const email = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const progress = ref('');
const errors = reactive({ newPassword: '', confirmPassword: '' });

watch([newPassword, confirmPassword], () => {
  errors.newPassword = '';
  errors.confirmPassword = '';
});

const validate = (): boolean => {
  Object.assign(errors, newPasswordErrors(newPassword.value, confirmPassword.value, DEFAULT_ADMIN.password));

  return errors.newPassword === '' && errors.confirmPassword === '';
};

// Only the default admin is held to setup, so its current password is always the documented default.
const finishSetup = async () => {
  if (email.value !== userStore.profile?.email) {
    progress.value = 'Changing your email...';

    await userService.changeEmail(email.value, DEFAULT_ADMIN.password);
  }

  progress.value = 'Changing your password...';
  await userService.changePassword(DEFAULT_ADMIN.password, newPassword.value);

  newPassword.value = '';
  confirmPassword.value = '';

  await router.push(userStore.hasRole(UserRoleId.USER_ADMIN) ? '/admin/invites' : '/getting-started');
  notificationStore.addToast('Your server is set up', 'Next, invite the people who will use it.');
};

const doFinishSetup = () => {
  if (busy.value) {
    return;
  }

  email.value = email.value.trim();

  if (!validate()) {
    return;
  }

  busy.value = true;

  finishSetup()
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doFinishSetup(): Setup failed');
    });
};

const doSignOut = () => {
  userService
    .logout()
    .then(() => router.push('/sign-in'))
    .catch((error: unknown) => {
      logger.error({ error }, 'doSignOut(): Sign out failed');
    });
};

watchEffect(() => {
  if (email.value === '') {
    email.value = userStore.profile?.email ?? '';
  }
});
</script>
