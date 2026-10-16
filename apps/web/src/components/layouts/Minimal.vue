<template>
  <div class="flex min-h-screen flex-col items-center gap-6 px-4 pb-6 pt-16">
    <div class="flex items-center gap-2.5 text-xl font-semibold text-header">
      <foxden-logo :size="32" />
      <span>Foxden</span>
    </div>

    <div class="w-full max-w-sm">
      <slot />
    </div>

    <app-footer class="mt-auto" />
  </div>
</template>

<script setup lang="ts">
import AppFooter from '@/components/AppFooter.vue';
import FoxdenLogo from '@/components/FoxdenLogo.vue';
</script>
