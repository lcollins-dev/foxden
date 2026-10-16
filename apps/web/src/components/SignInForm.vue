<template>
  <form v-if="step === 'email'" class="m-0" novalidate @submit.prevent="doContinue">
    <ui-form-heading :title="props.title" :subtitle="props.subtitle" />

    <ui-form-field v-slot="{ input }" label="Email" path="email" :error="emailError">
      <ui-input
        v-model:value="email"
        v-bind="input"
        type="email"
        autocomplete="username"
        name="email"
        placeholder="you@example.com"
        :disabled="busy"
      />
    </ui-form-field>

    <div v-if="unknownAccount" class="-mt-1 mb-5" data-testid="invite-only">
      <ui-notice type="info" title="Accounts are invite-only">
        Ask the person who runs this server for an invite, then come back and sign in.
      </ui-notice>
    </div>

    <ui-button type="primary" block native-type="submit" :loading="busy">Continue</ui-button>
  </form>

  <form v-else class="m-0" novalidate @submit.prevent="doSignIn">
    <ui-form-heading title="Enter your password" />

    <div class="mb-6 mt-3.5 flex items-center gap-2.5 rounded-full border border-divider bg-inset p-1 pl-3">
      <icon-account-circle class="size-4 text-muted" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-highlight" data-testid="sign-in-email">{{ email }}</span>
      <ui-button type="text" :disabled="busy" @click="doChangeEmail">Change</ui-button>
    </div>

    <ui-form-field v-slot="{ input }" label="Password" path="password" :error="passwordError">
      <ui-input
        v-model:value="password"
        type="password"
        v-bind="input"
        autocomplete="current-password"
        name="password"
        placeholder="Your password"
        :disabled="busy"
      />
    </ui-form-field>

    <ui-button v-if="!busy" type="primary" block native-type="submit">Sign In</ui-button>

    <template v-else>
      <ui-button type="primary" block disabled loading>Signing in...</ui-button>
      <div class="mt-2.5 text-center text-xs text-muted">{{ props.progress }}</div>
    </template>
  </form>
</template>

<script setup lang="ts">
import { PropType, ref, watch } from 'vue';
import IconAccountCircle from '~icons/material-symbols/account-circle-outline-rounded';

import { useLogService } from '@/services/LogService';
import { useFxaService } from '@/services/fxa/FxaService';
import { NO_ACCOUNT_MESSAGE } from '@/services/fxa/fxaError';

import { UiButton, UiFormField, UiFormHeading, UiInput, UiNotice } from '@/components/ui';

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    required: true,
  },
  initialEmail: {
    type: String,
    default: '',
  },
  progress: {
    type: String,
    default: '',
  },
  signIn: {
    type: Function as PropType<(email: string, password: string) => Promise<void>>,
    required: true,
  },
});

const logService = useLogService();
const logger = logService.createLogger('components/SignInForm');
const fxaService = useFxaService();

const step = ref<'email' | 'password'>('email');
const email = ref(props.initialEmail);
const password = ref('');
const busy = ref(false);
const emailError = ref('');
const passwordError = ref('');
const unknownAccount = ref(false);

watch(
  () => props.initialEmail,
  initialEmail => {
    if (email.value === '') {
      email.value = initialEmail;
    }
  }
);

watch(email, () => {
  emailError.value = '';
});

watch(password, () => {
  passwordError.value = '';
});

const doContinue = () => {
  if (busy.value) {
    return;
  }

  email.value = email.value.trim();
  unknownAccount.value = false;

  if (email.value === '') {
    emailError.value = 'Enter your email.';
    return;
  }

  busy.value = true;

  fxaService
    .accountExists(email.value)
    .then(exists => {
      if (exists) {
        step.value = 'password';
        return;
      }

      emailError.value = NO_ACCOUNT_MESSAGE;
      unknownAccount.value = true;
    })
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'doContinue(): The account check failed');
    });
};

const doChangeEmail = () => {
  step.value = 'email';
  password.value = '';
  passwordError.value = '';
};

const doSignIn = () => {
  if (busy.value) {
    return;
  }

  if (password.value === '') {
    passwordError.value = 'Enter your password.';
    return;
  }

  busy.value = true;

  props
    .signIn(email.value, password.value)
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'doSignIn(): Sign-in failed');
    });
};
</script>
