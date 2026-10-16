<template>
  <div class="flex flex-col items-center gap-2.5 py-2 text-center">
    <span class="inline-flex size-12 items-center justify-center rounded-full" :style="{ background: tint }">
      <component :is="props.icon" class="size-6" :style="{ color }" aria-hidden="true" />
    </span>

    <div class="mt-1 text-lg font-semibold text-header">{{ props.title }}</div>

    <p class="m-0 max-w-xs leading-normal text-normal"><slot /></p>

    <div v-if="$slots.actions" class="mt-2.5 flex gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Component, computed, PropType } from 'vue';

type ResultType = 'success' | 'warning' | 'error' | 'muted';

const TYPE_COLORS: Record<ResultType, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error-color)',
  muted: 'var(--fg-muted)',
};

const props = defineProps({
  icon: {
    type: [Object, Function] as PropType<Component>,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String as PropType<ResultType>,
    default: 'muted',
  },
});

const color = computed(() => TYPE_COLORS[props.type]);
const tint = computed(() => `color-mix(in srgb, ${color.value} 14%, transparent)`);
</script>
