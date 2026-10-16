<template>
  <dialog
    ref="dialog"
    class="m-auto w-full rounded-xl border border-divider bg-surface p-0 text-normal outline-hidden backdrop:animate-fade-in backdrop:bg-black/40"
    :aria-labelledby="titleId"
    autofocus
    @cancel.prevent="close"
    @close="onClose"
    @mousedown="onMousedown"
    @click="onClick"
  >
    <template v-if="show">
      <div class="flex items-center px-6 pb-3 pt-5">
        <div v-if="$slots.icon" class="mr-2.5 flex shrink-0">
          <slot name="icon" />
        </div>

        <h2 :id="titleId" class="min-w-0 flex-1 wrap-break-word text-lg font-semibold text-header">
          {{ props.title }}
        </h2>

        <button
          type="button"
          class="ml-2 flex size-5 cursor-pointer items-center justify-center rounded-lg bg-transparent text-muted outline-hidden hover:text-normal focus-visible:text-normal"
          aria-label="Close"
          @click="close"
        >
          <icon-close class="size-5" aria-hidden="true" />
        </button>
      </div>

      <div class="px-6 pb-5">
        <slot />
      </div>
    </template>
  </dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId, useTemplateRef, watch } from 'vue';
import IconClose from '~icons/material-symbols/close-rounded';

import { openModals } from './openModals';

const show = defineModel<boolean>('show', { required: true });

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
});

const dialog = useTemplateRef('dialog');

const titleId = useId();

const sync = () => {
  if (dialog.value === null) {
    return;
  }

  if (show.value && !dialog.value.open) {
    dialog.value.showModal();
    openModals.value = [...openModals.value, dialog.value];
  } else if (!show.value && dialog.value.open) {
    dialog.value.close();
    forget();
  }
};

const forget = () => {
  openModals.value = openModals.value.filter(open => open !== dialog.value);
};

onMounted(sync);
watch(show, sync, { flush: 'post' });
onBeforeUnmount(forget);

const close = () => {
  show.value = false;
};

// The browser can close a dialog itself, such as through a `<form method="dialog">`, without a cancel event.
const onClose = () => {
  forget();
  close();
};

// Keep the dialog unpadded: a click on the dialog element itself is a backdrop click, if the press began there too and
// is not a text selection dragged out of the card.
let pressedBackdrop = false;

const onMousedown = (event: MouseEvent) => {
  pressedBackdrop = event.target === dialog.value;
};

const onClick = (event: MouseEvent) => {
  if (pressedBackdrop && event.target === dialog.value) {
    close();
  }
};
</script>
