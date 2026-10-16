<template>
  <ui-modal :show="true" class="max-w-md" :title="props.options.title" data-testid="dialog" @update:show="cancel">
    <template #icon>
      <ui-disc-icon :icon="TYPE_ICONS[props.options.type]" :size="20" :class="TYPE_ICON_CLASSES[props.options.type]" />
    </template>

    <p class="mb-3 mt-0 wrap-break-word leading-normal">
      <template v-if="typeof props.options.message === 'string'">{{ props.options.message }}</template>
      <component :is="props.options.message" v-else />
    </p>

    <ui-form-field
      v-if="props.options.confirmText !== undefined"
      v-slot="{ input }"
      :label="props.options.confirmTextLabel ?? `Type ${props.options.confirmText} to confirm`"
    >
      <ui-input v-model:value="typed" :placeholder="props.options.confirmText" v-bind="input" name="confirm-text" />
    </ui-form-field>

    <div class="flex justify-end gap-2">
      <ui-button @click="cancel">{{ props.options.cancelLabel ?? 'Cancel' }}</ui-button>
      <ui-button
        :type="props.options.type === DialogType.DANGER ? 'danger' : 'primary'"
        :disabled="!canConfirm"
        :loading="busy"
        data-testid="dialog-confirm"
        @click="accept"
      >
        {{ props.options.confirmLabel }}
      </ui-button>
    </div>
  </ui-modal>
</template>

<script setup lang="ts">
import { type Component, computed, PropType, ref } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';
import IconInfo from '~icons/material-symbols/info-i-rounded';
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded';

import { DialogType, IDialogOptions } from '@/types/dialog';

import { useLogService } from '@/services/LogService';

import { UiButton, UiDiscIcon, UiFormField, UiInput, UiModal } from '@/components/ui';

const TYPE_ICONS: Record<DialogType, Component> = {
  [DialogType.INFO]: IconInfo,
  [DialogType.SUCCESS]: IconCheck,
  [DialogType.WARNING]: IconPriorityHigh,
  [DialogType.DANGER]: IconPriorityHigh,
};

const TYPE_ICON_CLASSES: Record<DialogType, string> = {
  [DialogType.INFO]: 'bg-primary text-surface',
  [DialogType.SUCCESS]: 'bg-success text-surface',
  [DialogType.WARNING]: 'bg-warning text-surface',
  [DialogType.DANGER]: 'bg-error text-surface',
};

const props = defineProps({
  options: {
    type: Object as PropType<IDialogOptions>,
    required: true,
  },
});

const emit = defineEmits<{
  close: [confirmed: boolean];
}>();

const logService = useLogService();
const logger = logService.createLogger('components/ConfirmDialog');

const typed = ref('');
const busy = ref(false);

const canConfirm = computed(() => {
  const confirmText = props.options.confirmText;

  return confirmText === undefined || typed.value.trim().toLowerCase() === confirmText.trim().toLowerCase();
});

const cancel = () => {
  emit('close', false);
};

const accept = () => {
  if (busy.value || !canConfirm.value) {
    return;
  }

  const action = props.options.action;

  if (action === undefined) {
    emit('close', true);
    return;
  }

  busy.value = true;

  action()
    .then(() => {
      emit('close', true);
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'accept(): The dialog action failed');
      busy.value = false;
    });
};
</script>
