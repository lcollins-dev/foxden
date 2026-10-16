<template>
  <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 py-4">
    <div class="shrink grow basis-72">
      <div class="font-medium text-highlight">{{ props.title }}</div>
      <div class="mt-0.5 text-xs leading-snug text-muted"><slot name="help" /></div>
    </div>

    <slot />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
});
</script>
