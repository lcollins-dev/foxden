import {
  BatchJobDto,
  BatchJobListResponseDto,
  BatchJobRunDto,
  BatchJobRunListResponseDto,
  type UpdateBatchJobStateRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useBatchJobAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getBatchJobList(): Promise<BatchJobListResponseDto> {
    const batchJobList = await apiService
      .makeRequest(`admin/batch-job/list`, RequestType.GET, {
        response: BatchJobListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return batchJobList;
  }

  async function getBatchJob(batchJobId: number, form: string | null = null): Promise<BatchJobDto> {
    const user = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}`, RequestType.GET, {
        response: BatchJobDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return user;
  }

  async function getBatchJobRunList(batchJobId: number): Promise<BatchJobRunListResponseDto> {
    const batchJobRunList = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/runs`, RequestType.GET, {
        response: BatchJobRunListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return batchJobRunList;
  }

  async function updateBatchJobState(
    updateBatchJobStateRequest: UpdateBatchJobStateRequestDto,
    batchJobId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateBatchJobStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  async function runBatchJob(batchJobId: number): Promise<BatchJobRunDto> {
    const batchJobRun = await apiService
      .makeRequest(`admin/batch-job/${batchJobId}/run`, RequestType.POST, {
        response: BatchJobRunDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    return batchJobRun;
  }

  return {
    getBatchJobList,
    getBatchJob,
    getBatchJobRunList,
    updateBatchJobState,
    runBatchJob,
  };
};
