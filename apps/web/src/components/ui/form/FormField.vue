<template>
  <div
    v-if="props.layout === 'row'"
    data-testid="form-field"
    class="flex flex-wrap items-start gap-x-6 gap-y-2 pb-1.5 pt-2.5"
  >
    <div class="flex min-h-8 min-w-44 shrink grow-0 basis-56 items-center">
      <ui-form-label :label="props.label" :help="props.help" :for="ids.input" :help-id="ids.help" />
    </div>

    <div class="max-w-sm shrink grow basis-64">
      <slot :input="input" />

      <div class="mt-1 min-h-4">
        <ui-field-error v-if="error" :id="ids.error" data-testid="field-error">{{ error }}</ui-field-error>
      </div>
    </div>
  </div>

  <div v-else data-testid="form-field" class="flex flex-col">
    <ui-form-label class="mb-1" :label="props.label" :help="props.help" :for="ids.input" :help-id="ids.help" />

    <slot :input="input" />

    <div class="mb-1.5 mt-1 min-h-4">
      <ui-field-error v-if="error" :id="ids.error" data-testid="field-error">{{ error }}</ui-field-error>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, PropType, useId } from 'vue';

import { fieldIds, fieldInputProps, IFieldInputProps } from '@/utils/fieldInput';

import UiFieldError from './FieldError.vue';
import UiFormLabel from './FormLabel.vue';
import { useFieldError } from './useFieldError';

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  help: {
    type: String,
    default: undefined,
  },
  path: {
    type: String,
    default: undefined,
  },
  error: {
    type: String,
    default: '',
  },
  layout: {
    type: String as PropType<'stacked' | 'row'>,
    default: 'stacked',
  },
});

defineSlots<{
  default(slotProps: { input: IFieldInputProps }): unknown;
}>();

const ids = fieldIds(useId());

const error = useFieldError(props);

const input = computed(() => fieldInputProps(ids, (props.help ?? '') !== '', error.value !== ''));
</script>
