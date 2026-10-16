<template>
  <ui-card>
    <template v-if="state === 'unavailable'">
      <ui-form-heading :title="unavailable.title" :subtitle="unavailable.text" />

      <ol class="mb-6 mt-0 flex list-decimal flex-col gap-2 pl-5 leading-normal text-normal">
        <li>Close this tab.</li>
        <li>In Firefox, open Settings, then Sync, and choose Sign in. Firefox opens this page itself.</li>
        <li>
          Still stuck? Check that <ui-code>identity.fxaccounts.autoconfig.uri</ui-code> is
          <ui-code>{{ serverUrl }}</ui-code> and restart Firefox.
        </li>
      </ol>

      <ui-button v-if="unavailable.canRetry" type="primary" block @click="doRetry"> Try Again </ui-button>
    </template>

    <sign-in-form
      v-else-if="state === 'form'"
      title="Sign in to Firefox Sync"
      subtitle="Use your Foxden account to sync bookmarks, history, passwords and tabs."
      :initial-email="initialEmail"
      :sign-in="doSignIn"
      :progress="PROGRESS_TEXT[progress]"
    />

    <div v-else-if="state === 'checking'" class="flex flex-col items-center gap-3 py-6 text-normal">
      <ui-spinner />
      Connecting to Firefox...
    </div>

    <ui-result v-else :icon="IconCheck" type="success" title="You're signed in" data-testid="firefox-signed-in">
      Firefox is starting to sync. It can take a few minutes for everything to appear. You can close this tab.

      <template #actions>
        <ui-button type="primary" to="/profile-and-security">Manage Your Account</ui-button>
      </template>
    </ui-result>
  </ui-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';

import type { IFirefoxOAuthParams, TSignInProgress } from '@/types/firefox';

import { FIREFOX_CONTEXT, readFirefoxOAuthParams } from '@/utils/firefoxOAuthParams';
import { reloadOnce } from '@/utils/reloadOnce';
import { isFirefoxForAndroid } from '@/utils/userAgent';

import { useLogService } from '@/services/LogService';
import { useServerService } from '@/services/api/ServerService';
import { useFirefoxSignInService } from '@/services/firefox/FirefoxSignInService';
import { useWebChannelService } from '@/services/firefox/WebChannelService';

import SignInForm from '@/components/SignInForm.vue';
import { UiButton, UiCard, UiCode, UiFormHeading, UiResult, UiSpinner } from '@/components/ui';

interface IUnavailable {
  title: string;
  text: string;
  canRetry: boolean;
}

const PROGRESS_TEXT: Record<TSignInProgress, string> = {
  password: 'Checking your password. This takes a second or two.',
  linking: 'Waiting for Firefox...',
  keys: 'Preparing your Sync keys...',
  firefox: 'Handing over to Firefox...',
};

const NOT_RESPONDING: IUnavailable = {
  title: "Firefox isn't responding",
  text: "This page finishes signing in by talking to Firefox, and Firefox hasn't answered. Usually that means the page wasn't opened by Firefox.",
  canRetry: true,
};

const logService = useLogService();
const logger = logService.createLogger('pages/firefox/SignIn');

const firefoxSignInService = useFirefoxSignInService();
const webChannelService = useWebChannelService();
const serverService = useServerService();

const state = ref<'checking' | 'unavailable' | 'form' | 'done'>('checking');
const unavailable = ref<IUnavailable>(NOT_RESPONDING);
const initialEmail = ref('');
const progress = ref<TSignInProgress>('password');
const serverUrl = ref(window.location.origin);

let params: IFirefoxOAuthParams | null = null;

const doSignIn = async (email: string, password: string) => {
  if (params === null) {
    return;
  }

  await firefoxSignInService.signIn(params, email, password, next => {
    progress.value = next;
  });

  state.value = 'done';
};

const checkFirefox = async (oauthParams: IFirefoxOAuthParams) => {
  const status = await webChannelService.fetchStatus(oauthParams.context);

  // Firefox for Android registers its WebChannel script for a custom server only as the first sign-in page opens,
  // so that page can miss it; a reload gets it (android-components fxawebchannel/background.js).
  if (status === null && isFirefoxForAndroid() && reloadOnce(oauthParams.state)) {
    return;
  }

  if (status === null) {
    unavailable.value = NOT_RESPONDING;
    state.value = 'unavailable';
    return;
  }

  initialEmail.value = status.signedInUser?.email ?? oauthParams.email;
  state.value = 'form';
};

/** Reloads rather than asking again, since only a fresh page gets a WebChannel script Firefox registered late. */
const doRetry = () => {
  window.location.reload();
};

onMounted(() => {
  serverService
    .getServerInfo()
    .then(serverInfo => {
      serverUrl.value = serverInfo.publicUrl;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'onMounted(): Failed to read the server info');
    });

  const query = new URLSearchParams(window.location.search);
  const parsed = readFirefoxOAuthParams(query);

  if (query.get('context') !== FIREFOX_CONTEXT) {
    unavailable.value = {
      title: "This Firefox can't sign in here",
      text: 'It asked to sign in in a way this server does not support. Update Firefox and start again from its Sync settings.',
      canRetry: false,
    };
    state.value = 'unavailable';
    return;
  }

  if ('missing' in parsed) {
    logger.warn({ missing: parsed.missing }, 'onMounted(): The sign-in link is missing OAuth params');
    unavailable.value = {
      title: 'This sign-in link is incomplete',
      text: "Firefox adds what it needs to this link when it opens the page, and some of it isn't here.",
      canRetry: false,
    };
    state.value = 'unavailable';
    return;
  }

  params = parsed;

  checkFirefox(parsed).catch((error: unknown) => {
    logger.error({ error }, 'onMounted(): Firefox did not answer');
    state.value = 'unavailable';
  });
});
</script>
