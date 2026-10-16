<template>
  <teleport :to="openModals.at(-1) ?? 'body'">
    <div class="fixed bottom-3 right-4 z-50 flex max-w-[calc(100%-2rem)] flex-col items-end" aria-live="polite">
      <transition-group
        enter-active-class="overflow-hidden transition-all duration-300 ease-out"
        leave-active-class="overflow-hidden transition-all duration-300 ease-in"
        enter-from-class="mt-0 max-h-0 translate-x-full opacity-0"
        leave-to-class="mt-0 max-h-0 translate-x-full opacity-0"
        enter-to-class="max-h-screen"
        leave-from-class="max-h-screen"
      >
        <div
          v-for="notification of notificationStore.notifications"
          :key="notification.id"
          class="relative mt-3 w-80 max-w-full rounded-xl border border-divider bg-popover px-3.5 text-sm text-normal"
          :data-testid="`notification-${notification.type}`"
        >
          <ui-disc-icon
            :icon="TYPE_ICONS[notification.type]"
            :size="18"
            class="absolute left-3.5 top-3"
            :class="TYPE_ICON_CLASSES[notification.type]"
          />

          <div class="ml-7 py-3">
            <div v-if="notification.title !== null" class="mb-1 pr-5 font-semibold text-header">
              {{ notification.title }}
            </div>

            <div :class="{ 'pr-5': notification.title === null }">
              <template v-if="typeof notification.content === 'string'">{{ notification.content }}</template>
              <component :is="notification.content" v-else />
            </div>
          </div>

          <button
            type="button"
            class="absolute right-2.5 top-2.5 flex size-5 cursor-pointer items-center justify-center rounded-lg bg-transparent text-muted outline-hidden hover:text-normal focus-visible:text-normal"
            aria-label="Close"
            @click="notificationStore.clearNotification(notification.id)"
          >
            <icon-close class="size-4" aria-hidden="true" />
          </button>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { type Component } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';
import IconClose from '~icons/material-symbols/close-rounded';
import IconInfo from '~icons/material-symbols/info-i-rounded';
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded';

import { NotificationType } from '@/types/notification';

import { useNotificationStore } from '@/stores/notification';

import { UiDiscIcon } from '@/components/ui';
import { openModals } from '@/components/ui/feedback/openModals';

const TYPE_ICONS: Record<NotificationType, Component> = {
  [NotificationType.INFO]: IconInfo,
  [NotificationType.SUCCESS]: IconCheck,
  [NotificationType.WARNING]: IconPriorityHigh,
  [NotificationType.ERROR]: IconClose,
};

const TYPE_ICON_CLASSES: Record<NotificationType, string> = {
  [NotificationType.INFO]: 'bg-primary text-popover',
  [NotificationType.SUCCESS]: 'bg-success text-popover',
  [NotificationType.WARNING]: 'bg-warning text-popover',
  [NotificationType.ERROR]: 'bg-error text-popover',
};

const notificationStore = useNotificationStore();
</script>
