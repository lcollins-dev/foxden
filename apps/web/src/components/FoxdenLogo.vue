<template>
  <img src="/logo.svg" :width="props.size" :height="props.size" class="block shrink-0" alt="" />
</template>

<script setup lang="ts">
const props = defineProps({
  size: {
    type: Number,
    default: 32,
  },
});
</script>
