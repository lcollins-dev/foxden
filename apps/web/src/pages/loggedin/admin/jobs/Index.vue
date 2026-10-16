<template>
  <ui-page wide>
    <ui-page-heading
      title="Background jobs"
      subtitle="Scheduled maintenance that keeps the server tidy. Schedules run on the server's clock."
    />

    <ui-card flush>
      <ui-table :columns="TABLE_COLUMNS">
        <ui-table-head>
          <span>Job</span>
          <span>Last run</span>
          <span>Result</span>
          <span>Enabled</span>
          <span></span>
        </ui-table-head>

        <ui-table-row
          v-for="batchJob of batchJobList"
          :key="batchJob.id"
          :to="`/admin/jobs/${batchJob.id}`"
          data-testid="job-row"
        >
          <div class="min-w-0">
            <div class="font-medium text-header">{{ batchJob.name }}</div>
            <div class="mt-0.5 font-mono text-xs text-muted">{{ batchJob.cronExpression ?? 'Not scheduled' }}</div>
          </div>

          <span class="font-mono text-xs">
            {{ batchJob.lastStartDate === null ? 'Never' : formatDayTime(new Date(batchJob.lastStartDate)) }}
          </span>

          <div>
            <ui-tag :type="JOB_RESULT_TAG_TYPES[jobResult(batchJob)]">
              {{ JOB_RESULT_LABELS[jobResult(batchJob)] }}
            </ui-tag>
          </div>

          <span @click.stop.prevent>
            <ui-switch
              :value="batchJob.enabled"
              :aria-label="`Run ${batchJob.name} on its schedule`"
              @update:value="enabled => doSetEnabled(batchJob, enabled)"
            />
          </span>

          <icon-chevron-right class="size-4 text-muted" aria-hidden="true" />
        </ui-table-row>
      </ui-table>

      <ui-empty v-if="loaded && batchJobList.length === 0">No background jobs are registered.</ui-empty>
    </ui-card>
  </ui-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { BatchJobDto } from '@libs/dto';

import { formatDayTime } from '@/utils/date';
import { JOB_RESULT_LABELS, JOB_RESULT_TAG_TYPES, jobResult } from '@/utils/jobResult';

import { useLogService } from '@/services/LogService';
import { useBatchJobAdminService } from '@/services/api/admin/BatchJobAdminService';
import { useNotificationStore } from '@/stores/notification';

import {
  UiCard,
  UiEmpty,
  UiPage,
  UiPageHeading,
  UiSwitch,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

const TABLE_COLUMNS = 'minmax(0, 1fr) 9rem 6rem 2.75rem 1.25rem';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/admin/jobs/Index');

const batchJobAdminService = useBatchJobAdminService();
const notificationStore = useNotificationStore();

const batchJobList = ref<BatchJobDto[]>([]);
const loaded = ref(false);

const doGetList = () => {
  batchJobAdminService
    .getBatchJobList()
    .then(response => {
      batchJobList.value = response.batchJobList;
    })
    .finally(() => {
      loaded.value = true;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetList(): Failed to list the jobs');
    });
};

const doSetEnabled = (batchJob: BatchJobDto, enabled: boolean) => {
  batchJobAdminService
    .updateBatchJobState({ enabled }, batchJob.id)
    .then(() => {
      batchJobList.value = batchJobList.value.map(listed =>
        listed.id === batchJob.id ? { ...listed, enabled } : listed
      );
      notificationStore.addToast(
        enabled ? 'Job enabled' : 'Job disabled',
        enabled ? `${batchJob.name} will run on its schedule.` : `${batchJob.name} won't run until you enable it.`
      );
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSetEnabled(): Failed to change the job state');
    });
};

onMounted(doGetList);
</script>
