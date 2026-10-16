<template>
  <ui-page data-testid="connect-firefox">
    <ui-page-heading title="Getting started">
      <template #subtitle>
        Do this once on each device you want to sync. You're signed in as
        <span class="text-highlight">{{ userStore.profile?.email }}.</span>
      </template>
    </ui-page-heading>

    <ui-notice v-if="needsHttps" type="error" title="This server needs HTTPS" data-testid="needs-https">
      Its address uses plain HTTP, so Firefox can't sign in to it. Serve it over HTTPS and set
      <ui-code>WEB_APP_BASE_URL</ui-code> to the <ui-code>https://</ui-code> address.
    </ui-notice>

    <ui-card flush title="Setup steps" subtitle="Takes about two minutes per device.">
      <template #header-extra>
        <ui-segmented v-model:value="platform" :options="PLATFORM_OPTIONS" aria-label="Firefox platform" />
      </template>

      <ui-steps v-if="platform === 'desktop'" data-testid="desktop-steps">
        <ui-step title="Sign out of any Mozilla account">
          In Firefox, open Settings, then Sync. If you're signed in to a Mozilla account, choose Sign out.
        </ui-step>

        <ui-step title="Open the advanced settings">
          Type <ui-code>about:config</ui-code> in the address bar and press Enter. Accept the warning if Firefox shows
          one.
        </ui-step>

        <ui-step title="Point Firefox at this server">
          Search for this setting and set it to this server's address.

          <ui-copy-values class="mt-3">
            <ui-copy-value label="Setting" :value="AUTOCONFIG_PREF" />
            <ui-copy-value label="Value" :value="serverUrl" value-test-id="autoconfig-uri" />
          </ui-copy-values>
        </ui-step>

        <ui-step v-if="needsHttp" title="Allow a server without HTTPS" data-testid="allow-http-step">
          This server uses plain HTTP, so Firefox needs one more setting. Add it as a Boolean if it doesn't exist.

          <ui-copy-values class="mt-3">
            <ui-copy-value label="Setting" :value="ALLOW_HTTP_PREF" />
            <ui-copy-value label="Value" value="true" />
          </ui-copy-values>
        </ui-step>

        <ui-step title="Restart Firefox and sign in">
          Quit and reopen Firefox, then go to Settings, then Sync, and choose Sign in. Firefox opens this server's
          sign-in page.
        </ui-step>
      </ui-steps>

      <ui-steps v-else-if="platform === 'android'" data-testid="android-steps">
        <ui-step title="Turn on the debug menu">
          Open Settings, then About Firefox, and tap the Firefox logo five times.
        </ui-step>

        <ui-step title="Open Sync Debug">Go back to Settings and open Sync Debug.</ui-step>

        <ui-step title="Point Firefox at this server">
          Set Custom Mozilla account server to this server's address. Leave Custom Sync server empty: Firefox finds it
          from the account server.

          <ui-copy-values class="mt-3">
            <ui-copy-value label="Value" :value="serverUrl" value-test-id="android-server-url" />
          </ui-copy-values>

          <ui-notice v-if="needsHttp" type="warning" class="mt-3" data-testid="mobile-needs-https">
            Firefox for Android and iOS sign in only over HTTPS, and this server uses plain HTTP.
          </ui-notice>
        </ui-step>

        <ui-step title="Restart Firefox and sign in">
          Tap Stop Firefox, open it again and sign in to Sync from Settings.
        </ui-step>
      </ui-steps>

      <ui-steps v-else data-testid="ios-steps">
        <ui-step title="Sign out of any Mozilla account">
          In Firefox, open Settings and sign out of any Mozilla account. The setting below is hidden while signed in.
        </ui-step>

        <ui-step title="Turn on the debug settings">Open Settings and tap the version number five times.</ui-step>

        <ui-step title="Point Firefox at this server">
          Open Advanced Sync Settings, turn on Use Custom FxA Content Server and set Custom Account Content Server URI
          to this server's address. Leave the custom Sync token server off: on its own it points sign-in at Mozilla's
          test server.

          <ui-copy-values class="mt-3">
            <ui-copy-value label="Value" :value="serverUrl" value-test-id="ios-server-url" />
          </ui-copy-values>

          <ui-notice v-if="needsHttp" type="warning" class="mt-3" data-testid="mobile-needs-https">
            Firefox for Android and iOS sign in only over HTTPS, and this server uses plain HTTP.
          </ui-notice>
        </ui-step>

        <ui-step title="Sign in">Go back to Settings and sign in to Sync.</ui-step>
      </ui-steps>
    </ui-card>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { useLogService } from '@/services/LogService';
import { useServerService } from '@/services/api/ServerService';
import { useUserStore } from '@/stores/user';

import {
  type ISegmentedOption,
  UiCard,
  UiCode,
  UiCopyValue,
  UiCopyValues,
  UiNotice,
  UiPage,
  UiPageHeading,
  UiSegmented,
  UiStep,
  UiSteps,
} from '@/components/ui';

type Platform = 'desktop' | 'android' | 'ios';

const PLATFORM_OPTIONS: ISegmentedOption<Platform>[] = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

const AUTOCONFIG_PREF = 'identity.fxaccounts.autoconfig.uri';
const ALLOW_HTTP_PREF = 'identity.fxaccounts.allowHttp';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/ConnectFirefox');

const serverService = useServerService();
const userStore = useUserStore();

const platform = ref<Platform>('desktop');

const serverUrl = ref(window.location.origin);

/** Browsers treat plain HTTP as a secure context only on loopback, and sign-in needs one for its crypto. */
const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  /^127\.\d+\.\d+\.\d+$/.test(hostname);

const serverAddress = computed(() => new URL(serverUrl.value));

const isPlainHttp = computed(() => serverAddress.value.protocol === 'http:');

const needsHttp = computed(() => isPlainHttp.value && isLoopback(serverAddress.value.hostname));

const needsHttps = computed(() => isPlainHttp.value && !isLoopback(serverAddress.value.hostname));

onMounted(() => {
  serverService
    .getServerInfo()
    .then(serverInfo => {
      serverUrl.value = serverInfo.publicUrl;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'onMounted(): Failed to read the server info');
    });
});
</script>
