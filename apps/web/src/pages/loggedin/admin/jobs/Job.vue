<template>
  <ui-page>
    <ui-page-heading
      v-if="batchJob"
      :title="batchJob.name"
      :subtitle="batchJob.desc"
      back-to="/admin/jobs"
      back-label="Background jobs"
    >
      <ui-switch-label
        :value="batchJob.enabled"
        :aria-label="`Run ${batchJob.name} on its schedule`"
        :loading="busy"
        label-first
        @update:value="doSetEnabled"
      >
        <span data-testid="job-state">{{ batchJob.enabled ? 'Enabled' : 'Disabled' }}</span>
      </ui-switch-label>
    </ui-page-heading>

    <ui-back-link v-else to="/admin/jobs" label="Background jobs" />

    <ui-card v-if="batchJob" title="Schedule">
      <ui-stat-grid>
        <ui-stat label="Cron" mono>{{ batchJob.cronExpression ?? 'Not scheduled' }}</ui-stat>
        <ui-stat label="Last success" mono>{{ formatOptional(batchJob.lastSuccessDate) }}</ui-stat>
        <ui-stat label="Last failure" mono>{{ formatOptional(batchJob.lastFailDate) }}</ui-stat>
      </ui-stat-grid>
    </ui-card>

    <ui-card
      v-if="batchJob"
      title="Recent runs"
      subtitle="Newest first. The oldest are pruned as new runs finish."
      flush
    >
      <template #header-extra>
        <ui-button type="primary" data-testid="job-run-now" @click="doRunNow">
          <template #icon><icon-play-arrow class="size-4" aria-hidden="true" /></template>
          Run Now
        </ui-button>
      </template>

      <ui-table :columns="RUN_TABLE_COLUMNS">
        <ui-table-head>
          <span>Started</span>
          <span>Duration</span>
          <span>Result</span>
          <span></span>
        </ui-table-head>

        <job-run-row v-for="batchJobRun of batchJobRunList" :key="batchJobRun.id" :batch-job-run="batchJobRun" />
      </ui-table>

      <ui-empty v-if="runsLoaded && batchJobRunList.length === 0">This job hasn't run yet.</ui-empty>
    </ui-card>
  </ui-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import IconPlayArrow from '~icons/material-symbols/play-arrow-outline-rounded';

import { BatchJobRunResult, type BatchJobDto, type BatchJobRunDto } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { formatDayTime } from '@/utils/date';

import { useLogService } from '@/services/LogService';
import { useBatchJobAdminService } from '@/services/api/admin/BatchJobAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import JobRunRow from '@/components/JobRunRow.vue';
import {
  UiBackLink,
  UiButton,
  UiCard,
  UiEmpty,
  UiPage,
  UiPageHeading,
  UiStat,
  UiStatGrid,
  UiSwitchLabel,
  UiTable,
  UiTableHead,
} from '@/components/ui';

const RUN_TABLE_COLUMNS = 'minmax(0, 1fr) 7rem 6rem 1.25rem';
const RUN_POLL_MS = 2000;

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/admin/jobs/Job');

const route = useRoute();

const batchJobAdminService = useBatchJobAdminService();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();

const batchJobId = computed(() =>
  typeof route.params.batchJobId === 'string' ? parseInt(route.params.batchJobId, 10) : null
);

const batchJob = ref<BatchJobDto | null>(null);
const busy = ref(false);

const batchJobRunList = ref<BatchJobRunDto[]>([]);
const runsLoaded = ref(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let unmounted = false;

const formatOptional = (date: Date | null): string => (date === null ? 'Never' : formatDayTime(new Date(date)));

const doGetRuns = () => {
  if (batchJobId.value === null) {
    return;
  }

  batchJobAdminService
    .getBatchJobRunList(batchJobId.value)
    .then(response => {
      batchJobRunList.value = response.batchJobRunList;
      runsLoaded.value = true;
      doPollWhileRunning();
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetRuns(): Failed to list the job runs');
      doPollWhileRunning();
    });
};

const doGetBatchJob = () => {
  if (batchJobId.value === null) {
    return;
  }

  batchJobAdminService
    .getBatchJob(batchJobId.value)
    .then(response => {
      batchJob.value = response;
      doGetRuns();
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetBatchJob(): Failed to read the job');
      doPollWhileRunning();
    });
};

const doSetEnabled = (enabled: boolean) => {
  if (batchJob.value === null) {
    return;
  }

  const name = batchJob.value.name;
  busy.value = true;

  batchJobAdminService
    .updateBatchJobState({ enabled }, batchJob.value.id)
    .then(() => {
      notificationStore.addToast(
        enabled ? 'Job enabled' : 'Job disabled',
        enabled ? `${name} will run on its schedule.` : `${name} won't run until you enable it.`
      );
      doGetBatchJob();
    })
    .finally(() => {
      busy.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSetEnabled(): Failed to change the job state');
    });
};

const doStopPolling = () => {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};

const doPollWhileRunning = () => {
  doStopPolling();

  if (!unmounted && batchJobRunList.value.some(batchJobRun => batchJobRun.result === BatchJobRunResult.RUNNING)) {
    pollTimer = setTimeout(doGetBatchJob, RUN_POLL_MS);
  }
};

const doRunNow = () => {
  if (batchJob.value === null) {
    return;
  }

  const target = batchJob.value;

  void dialogStore.confirm({
    type: DialogType.INFO,
    title: `Run ${target.name} now?`,
    message: 'It runs once in the background, outside its schedule. You can follow it under Recent runs.',
    confirmLabel: 'Run Now',
    action: async () => {
      const batchJobRun = await batchJobAdminService.runBatchJob(target.id);

      batchJobRunList.value = [batchJobRun, ...batchJobRunList.value];
      runsLoaded.value = true;
      doPollWhileRunning();
    },
  });
};

watchEffect(doGetBatchJob);

onUnmounted(() => {
  unmounted = true;
  doStopPolling();
});
</script>
