<template>
  <div class="relative rounded-xl border py-2.5 pl-10 pr-3 text-sm" :class="TYPE_CLASSES[props.type]" role="alert">
    <ui-disc-icon
      :icon="NOTICE_ICONS[props.type]"
      :size="20"
      class="absolute left-3 top-2.5"
      :class="ICON_CLASSES[props.type]"
    />

    <div v-if="props.title" class="mb-0.5 font-medium text-header">{{ props.title }}</div>

    <div class="text-normal">
      <slot />
    </div>

    <div v-if="$slots.action" class="mt-3 flex justify-end">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Component, PropType } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';
import IconClose from '~icons/material-symbols/close-rounded';
import IconInfo from '~icons/material-symbols/info-i-rounded';
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded';

import UiDiscIcon from '../display/DiscIcon.vue';

type NoticeType = 'info' | 'success' | 'warning' | 'error';

const NOTICE_ICONS: Record<NoticeType, Component> = {
  info: IconInfo,
  success: IconCheck,
  warning: IconPriorityHigh,
  error: IconClose,
};

const TYPE_CLASSES: Record<NoticeType, string> = {
  info: 'border-transparent bg-primary-soft',
  success: 'border-transparent bg-success-soft',
  warning: 'border-transparent bg-warning-soft',
  error: 'border-error-line bg-error-soft',
};

const ICON_CLASSES: Record<NoticeType, string> = {
  info: 'bg-accent text-surface',
  success: 'bg-success text-surface',
  warning: 'bg-warning text-surface',
  error: 'bg-error text-surface',
};

const props = defineProps({
  type: {
    type: String as PropType<NoticeType>,
    default: 'info',
  },
  title: {
    type: String,
    default: undefined,
  },
});
</script>
