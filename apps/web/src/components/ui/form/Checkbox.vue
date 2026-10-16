<template>
  <label
    class="group flex cursor-pointer items-start"
    :class="[{ 'cursor-not-allowed opacity-50': props.disabled }, $attrs.class]"
  >
    <span class="relative flex h-5 w-4 shrink-0 items-center">
      <input
        v-model="checked"
        type="checkbox"
        class="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        :disabled="props.disabled"
        v-bind="inputAttrs"
      />

      <span
        class="flex size-4 items-center justify-center rounded-md border transition-colors duration-300 group-hover:border-primary peer-focus:border-primary peer-focus:ring-2 peer-focus:ring-primary-soft"
        :class="checked ? 'border-primary bg-primary text-on-primary dark:text-surface' : 'border-line bg-transparent'"
        aria-hidden="true"
      >
        <icon-check v-if="checked" class="size-4" />
      </span>
    </span>

    <span class="px-2"><slot /></span>
  </label>
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';

import { inputAttrsOf } from '@/utils/fieldInput';

defineOptions({ inheritAttrs: false });

const checked = defineModel<boolean>('checked', { required: true });

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
});

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));
</script>
