<template>
  <div class="mx-auto mt-16 max-w-sm">
    <ui-result :icon="IconError" type="error" title="Something went wrong">
      We couldn't finish that. Try again in a moment. If it keeps happening, check the browser console and the server
      logs.

      <ui-code v-if="errorMessage" class="mt-2.5 block">{{ errorMessage }}</ui-code>

      <template #actions>
        <ui-button to="/">Go Home</ui-button>

        <ui-button type="primary" @click="doRetry">Try Again</ui-button>
      </template>
    </ui-result>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import IconError from '~icons/material-symbols/error-outline-rounded';

import { useLogService } from '@/services/LogService';
import { useErrorStore } from '@/stores/error';

import { UiButton, UiCode, UiResult } from '@/components/ui';

const logService = useLogService();
const logger = logService.createLogger('pages/Error');

const router = useRouter();

const errorStore = useErrorStore();

const errorMessage = computed(() => {
  const error = errorStore.vueError;

  if (typeof error !== 'object' || error === null || !('message' in error) || typeof error.message !== 'string') {
    return '';
  }

  return error.message;
});

const doRetry = () => {
  router.back();
};

watchEffect(() => {
  if (errorStore.vueError === null) {
    router.push('/').catch((error: unknown) => {
      logger.error({ error }, 'watchEffect(): Failed to navigate home');
    });
  }
});
</script>
