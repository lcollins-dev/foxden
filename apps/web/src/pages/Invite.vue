<template>
  <ui-card class="mx-auto mt-10 max-w-sm">
    <div v-if="state === InviteState.VALID && invite" data-testid="invite-form">
      <form class="m-0" novalidate @submit.prevent="doCreateAccount">
        <ui-form-heading
          title="Accept your invite"
          subtitle="Choose a password for your Foxden account. Next, you'll connect Firefox."
        />

        <ui-form-field v-slot="{ input }" label="Email" path="email">
          <ui-input :value="invite.email" readonly v-bind="input" name="email" autocomplete="username">
            <template #suffix>
              <icon-lock class="size-4 text-muted" aria-hidden="true" />
            </template>
          </ui-input>
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          label="Password"
          :help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
          :error="errors.password"
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

        <ui-button type="primary" block native-type="submit" :loading="busy">Create Account</ui-button>
      </form>
    </div>

    <ui-result
      v-else-if="problem"
      :icon="problem.icon"
      type="warning"
      :title="problem.title"
      data-testid="invite-problem"
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

import { CheckedInviteDto, InviteState } from '@libs/dto';

import { apiTokenForSession } from '@/utils/apiToken';
import { MIN_PASSWORD_LENGTH } from '@/utils/newPasswordError';

import { useLogService } from '@/services/LogService';
import { useInviteService } from '@/services/api/InviteService';
import { useServerService } from '@/services/api/ServerService';
import { useUserService } from '@/services/api/UserService';
import { useFxaService } from '@/services/fxa/FxaService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { UiButton, UiCard, UiFormField, UiFormHeading, UiInput, UiResult, UiSpinner } from '@/components/ui';

interface IInviteProblem {
  icon: Component;
  title: string;
  text: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const logService = useLogService();
const logger = logService.createLogger('pages/Invite');

const route = useRoute();
const router = useRouter();

const fxaService = useFxaService();
const inviteService = useInviteService();
const serverService = useServerService();
const userService = useUserService();
const notificationStore = useNotificationStore();
const userStore = useUserStore();

const token = String(route.params.token);

const state = ref<InviteState | null>(null);
const invite = ref<CheckedInviteDto | null>(null);
const lifetimeDays = ref<number | null>(null);
const password = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const errors = reactive({ password: '', confirmPassword: '' });

const problem = computed<IInviteProblem | null>(() => {
  switch (state.value) {
    case InviteState.INVALID:
      return {
        icon: IconLinkOff,
        title: "This Invite Link Isn't Valid",
        text: 'Check that you copied the whole link, or ask your admin for a new one.',
      };
    case InviteState.EXPIRED:
      return {
        icon: IconTimerOff,
        title: 'This Invite Has Expired',
        text: `${lifetimeDays.value === null ? 'Invites expire' : `Invites last ${lifetimeDays.value} days`}. Ask your admin to send you a new one.`,
      };
    case InviteState.USED:
      return {
        icon: IconTaskAlt,
        title: 'This Invite Has Already Been Used',
        text: "An account was already created with it. If it's yours, sign in with the password you chose.",
      };
    default:
      return null;
  }
});

watch(password, () => {
  errors.password = '';
});

watch(confirmPassword, () => {
  errors.confirmPassword = '';
});

const validate = (): boolean => {
  errors.password =
    password.value.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : '';
  errors.confirmPassword =
    errors.password === '' && password.value !== confirmPassword.value ? "The passwords don't match." : '';

  return errors.password === '' && errors.confirmPassword === '';
};

const createAccount = async (email: string) => {
  const session = await fxaService.signUp({ email, password: password.value, inviteToken: token });

  userStore.setToken(await apiTokenForSession(session.sessionToken));
  await userService.getProfile();

  password.value = '';
  confirmPassword.value = '';

  await router.push('/getting-started');
  notificationStore.addToast('Account created', 'Now connect Firefox to start syncing.');
};

const doCreateAccount = () => {
  if (busy.value) {
    return;
  }

  if (invite.value === null || !validate()) {
    return;
  }

  busy.value = true;

  createAccount(invite.value.email)
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'doCreateAccount(): Creating the account failed');
    });
};

onMounted(() => {
  inviteService
    .checkInvite(token)
    .then(checked => {
      invite.value = checked.invite;
      state.value = checked.state;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'onMounted(): Invite check failed');
      state.value = InviteState.INVALID;
    });

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
