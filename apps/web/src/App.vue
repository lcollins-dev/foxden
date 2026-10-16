<template>
  <component :is="layoutComponent">
    <router-view></router-view>
  </component>

  <dialog-host />

  <notification-stack />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { useThemeStore } from '@/stores/theme';

import NotificationStack from '@/components/NotificationStack.vue';
import DialogHost from '@/components/dialog/DialogHost.vue';
import { Layout, LAYOUT_COMPONENTS } from '@/components/layouts';

// Created here so the stored theme reaches the root element on every route, signed in or not.
useThemeStore();

const route = useRoute();

const layoutComponent = computed(() => LAYOUT_COMPONENTS[route.meta.layout ?? Layout.DEFAULT]);
</script>
