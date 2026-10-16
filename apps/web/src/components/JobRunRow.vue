<template>
  <ui-table-row :class="{ 'cursor-pointer': expandable }" data-testid="job-run" @click="toggle">
    <span class="font-mono text-xs">{{ formatDayTime(new Date(props.batchJobRun.startDate)) }}</span>

    <span class="font-mono text-xs">{{ duration }}</span>

    <div>
      <ui-tag :type="JOB_RUN_RESULT_TAG_TYPES[props.batchJobRun.result]">
        {{ JOB_RUN_RESULT_LABELS[props.batchJobRun.result] }}
      </ui-tag>
    </div>

    <button
      v-if="expandable"
      type="button"
      class="inline-flex text-muted"
      :aria-expanded="expanded"
      aria-label="Show the error"
      @click.stop="toggle"
    >
      <icon-expand-more v-if="expanded" class="size-4" aria-hidden="true" />
      <icon-chevron-right v-else class="size-4" aria-hidden="true" />
    </button>

    <span v-else></span>

    <div
      v-if="expanded"
      class="col-span-full -mx-4 -mb-3 cursor-text whitespace-pre-wrap wrap-break-word border-t border-divider bg-inset px-4 py-3 font-mono text-xs leading-relaxed text-error shadow-[inset_0_2px_4px_rgb(0_0_0/0.12)]"
      data-testid="job-run-error"
      @click.stop
    >
      {{ props.batchJobRun.error }}
    </div>
  </ui-table-row>
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';

import type { BatchJobRunDto } from '@libs/dto';

import { formatDayTime, formatDuration } from '@/utils/date';
import { JOB_RUN_RESULT_LABELS, JOB_RUN_RESULT_TAG_TYPES } from '@/utils/jobResult';

import { UiTableRow, UiTag } from '@/components/ui';

/** Place inside a UiTable with four columns: Started, Duration, Result and the toggle. */
const props = defineProps({
  batchJobRun: {
    type: Object as PropType<BatchJobRunDto>,
    required: true,
  },
});

const expanded = ref(false);

const expandable = computed(() => props.batchJobRun.error !== null);

const duration = computed(() =>
  props.batchJobRun.endDate === null
    ? '-'
    : formatDuration(new Date(props.batchJobRun.endDate).getTime() - new Date(props.batchJobRun.startDate).getTime())
);

const toggle = () => {
  if (expandable.value) {
    expanded.value = !expanded.value;
  }
};
</script>
