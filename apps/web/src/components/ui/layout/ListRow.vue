<template>
  <div class="flex flex-wrap items-center gap-3.5 border-b border-divider py-3.5 pl-6 pr-4 last:border-b-0">
    <span
      v-if="$slots.icon"
      class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-emphasis text-highlight"
    >
      <slot name="icon" />
    </span>

    <div class="min-w-48 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium text-header">{{ props.title }}</span>
        <slot name="tags" />
      </div>
      <div v-if="props.meta" class="mt-0.5 text-xs text-muted">{{ props.meta }}</div>
    </div>

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  meta: {
    type: String,
    default: undefined,
  },
});
</script>
