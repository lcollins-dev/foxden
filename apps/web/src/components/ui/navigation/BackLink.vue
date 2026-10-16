<template>
  <router-link v-slot="{ href }" :to="props.to" custom>
    <a
      :href="href"
      class="-ml-1.5 -mt-1.5 mb-3.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-inset hover:text-highlight"
      @click="onClick"
    >
      <icon-arrow-back class="size-4" aria-hidden="true" />
      {{ props.label }}
    </a>
  </router-link>
</template>

<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router';
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded';

import { useLogService } from '@/services/LogService';

const logService = useLogService();
const logger = logService.createLogger('components/ui/navigation/BackLink');

/** Returns through history when the previous entry is in this app, and to `to` otherwise. */
const props = defineProps({
  to: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
});

const router = useRouter();

const onClick = (event: MouseEvent) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }

  event.preventDefault();

  // The router records `back` only for an entry it pushed, so a deep link or another site leaves it null.
  if (typeof router.options.history.state.back === 'string') {
    router.back();
    return;
  }

  router.push(props.to).catch((error: unknown) => {
    logger.error({ error }, 'onClick(): Failed to navigate up');
  });
};
</script>
