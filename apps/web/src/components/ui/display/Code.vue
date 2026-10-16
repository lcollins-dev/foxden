<template>
  <code :class="[CODE_CLASS, props.emphasis ? 'bg-emphasis' : 'bg-inset']"><slot /></code>
</template>

<script setup lang="ts">
const CODE_CLASS = 'break-all rounded-md px-1 py-px font-mono text-xs text-highlight';

const props = defineProps({
  emphasis: {
    type: Boolean,
    default: false,
  },
});
</script>
