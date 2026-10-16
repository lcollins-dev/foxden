<template>
  <ui-card class="mx-auto mt-10 max-w-sm">
    <div v-if="state === PasswordResetState.VALID && passwordReset" data-testid="reset-password-form">
      <form class="m-0" novalidate @submit.prevent="doResetPassword">
        <ui-form-heading title="Reset your password" subtitle="Choose a new password for your Foxden account." />

        <ui-notice type="warning" title="Your sync data starts over" class="mb-5" data-testid="reset-password-warning">
          Data stored only on this server will be lost. Each Firefox is signed out; sign it in again with your new
          password and it uploads what it still has.
        </ui-notice>

        <ui-form-field v-slot="{ input }" label="Email">
          <ui-input :value="passwordReset.email" readonly v-bind="input" name="email" autocomplete="username">
            <template #suffix>
              <icon-lock class="size-4 text-muted" aria-hidden="true" />
            </template>
          </ui-input>
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          label="New password"
          :help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
          :error="errors.newPassword"
        >
          <ui-input
            v-model:value="password"
            type="password"
            v-bind="input"
            autocomplete="new-password"
            name="password"
            placeholder="Choose a password"
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

        <ui-checkbox v-model:checked="understood" class="mb-5" :disabled="busy" data-testid="reset-password-understood">
          I understand data stored only on this server will be lost.
        </ui-checkbox>

        <ui-button type="primary" block native-type="submit" :disabled="!understood" :loading="busy">
          Reset Password
        </ui-button>
      </form>
    </div>

    <ui-result
      v-else-if="problem"
      :icon="problem.icon"
      type="warning"
      :title="problem.title"
      data-testid="reset-password-problem"
    >
      {{ problem.text }}

      <template #actions>
        <ui-button to="/sign-in">Go to Sign In</ui-button>
      </template>
    </ui-result>

    <div v-else class="flex justify-center py-6">
      <ui-spinner />
    </div>
  </ui-card>
</template>

<script setup lang="ts">
import { type Component, computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconLinkOff from '~icons/material-symbols/link-off-rounded';
import IconLock from '~icons/material-symbols/lock-outline-rounded';
import IconTaskAlt from '~icons/material-symbols/task-alt-rounded';
import IconTimerOff from '~icons/material-symbols/timer-off-outline-rounded';

import { CheckedPasswordResetDto, PasswordResetState } from '@libs/dto';

import { Notification, NotificationType } from '@/types/notification';

import { apiTokenForSession } from '@/utils/apiToken';
import { MIN_PASSWORD_LENGTH, newPasswordErrors } from '@/utils/newPasswordError';

import { useLogService } from '@/services/LogService';
import { usePasswordResetService } from '@/services/api/PasswordResetService';
import { useUserService } from '@/services/api/UserService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import {
  UiButton,
  UiCard,
  UiCheckbox,
  UiFormField,
  UiFormHeading,
  UiInput,
  UiNotice,
  UiResult,
  UiSpinner,
} from '@/components/ui';

interface IResetProblem {
  icon: Component;
  title: string;
  text: string;
}

const SIGN_IN_AFTER_RESET_FAILED =
  'Your password was reset, but signing you in failed. Sign in with your new password.';

const logService = useLogService();
const logger = logService.createLogger('pages/ResetPassword');

const route = useRoute();
const router = useRouter();

const passwordResetService = usePasswordResetService();
const userService = useUserService();
const notificationStore = useNotificationStore();
const userStore = useUserStore();

const token = String(route.params.token);

const state = ref<PasswordResetState | null>(null);
const passwordReset = ref<CheckedPasswordResetDto | null>(null);
const password = ref('');
const confirmPassword = ref('');
const understood = ref(false);
const busy = ref(false);
const errors = reactive({ newPassword: '', confirmPassword: '' });

const problem = computed<IResetProblem | null>(() => {
  switch (state.value) {
    case PasswordResetState.INVALID:
      return {
        icon: IconLinkOff,
        title: "This Reset Link Isn't Valid",
        text: 'Check that you copied the whole link, or ask your admin for a new one.',
      };
    case PasswordResetState.EXPIRED:
      return {
        icon: IconTimerOff,
        title: 'This Reset Link Has Expired',
        text: 'Ask your admin to make you a new one.',
      };
    case PasswordResetState.USED:
      return {
        icon: IconTaskAlt,
        title: 'This Reset Link Has Already Been Used',
        text: 'The password was already reset with it. If that was you, sign in with the password you chose.',
      };
    default:
      return null;
  }
});

watch(password, () => {
  errors.newPassword = '';
});

watch(confirmPassword, () => {
  errors.confirmPassword = '';
});

const validate = (): boolean => {
  Object.assign(errors, newPasswordErrors(password.value, confirmPassword.value, ''));

  return errors.newPassword === '' && errors.confirmPassword === '';
};

const checkLink = async () => {
  const checked = await passwordResetService.checkPasswordReset(token);

  passwordReset.value = checked.passwordReset;
  state.value = checked.state;
};

/** A refused reset re-checks the link, so a link that went while the page was open shows why. */
const resetPassword = async () => {
  let sessionToken: string;

  try {
    sessionToken = await passwordResetService.resetPassword(token, password.value);
  } catch {
    await checkLink().catch((checkError: unknown) => {
      logger.info({ error: checkError }, 'resetPassword(): Password reset check failed');
      state.value = PasswordResetState.INVALID;
    });
    return;
  }

  password.value = '';
  confirmPassword.value = '';

  userStore.setToken(await apiTokenForSession(sessionToken));
  await userService.getProfile();

  await router.push('/getting-started');
  notificationStore.addToast('Password reset', 'Sign in to Firefox again with your new password to keep syncing.');
};

const doResetPassword = () => {
  if (busy.value || !understood.value) {
    return;
  }

  if (passwordReset.value === null || !validate()) {
    return;
  }

  busy.value = true;

  resetPassword()
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doResetPassword(): Failed to sign in after the reset');
      notificationStore.addNotification(new Notification(SIGN_IN_AFTER_RESET_FAILED, NotificationType.ERROR));
    });
};

onMounted(() => {
  checkLink().catch((error: unknown) => {
    logger.info({ error }, 'onMounted(): Password reset check failed');
    state.value = PasswordResetState.INVALID;
  });
});
</script>
