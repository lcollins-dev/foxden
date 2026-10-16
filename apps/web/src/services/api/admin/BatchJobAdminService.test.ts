import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobDto, BatchJobListResponseDto, BatchJobRunDto, BatchJobRunListResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { useBatchJobAdminService } from './BatchJobAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'signed-jwt' };

describe('useBatchJobAdminService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;
  let clearAllNotificationsMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue(undefined);
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    clearValidationErrorMock = vi.fn();
    clearAllNotificationsMock = vi.fn<() => void>();

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: clearValidationErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);

    useNotificationStore().clearAllNotifications = clearAllNotificationsMock;
    useUserStore().setToken('signed-jwt');
  });

  it('reads the batch job list, leaving notifications alone', async () => {
    makeRequestMock.mockResolvedValue({ batchJobList: [] });

    const response = await useBatchJobAdminService().getBatchJobList();

    expect(makeRequestMock).toHaveBeenCalledWith('admin/batch-job/list', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: BatchJobListResponseDto,
    });
    expect(response).toEqual({ batchJobList: [] });
    expect(clearAllNotificationsMock).not.toHaveBeenCalled();
  });

  it('reads a single batch job by id', async () => {
    makeRequestMock.mockResolvedValue({ id: 100 });

    await useBatchJobAdminService().getBatchJob(100);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/batch-job/100', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: BatchJobDto,
      form: null,
    });
  });

  it("reads a batch job's runs by id", async () => {
    makeRequestMock.mockResolvedValue({ batchJobRunList: [] });

    const response = await useBatchJobAdminService().getBatchJobRunList(100);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/batch-job/100/runs', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: BatchJobRunListResponseDto,
    });
    expect(response).toEqual({ batchJobRunList: [] });
  });

  it('patches the enabled state of a batch job', async () => {
    await useBatchJobAdminService().updateBatchJobState({ enabled: false }, 100);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/batch-job/100/state', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      body: { enabled: false },
      form: null,
    });
  });

  it('leaves notifications alone when reading a job or its runs, which the job page polls', async () => {
    makeRequestMock.mockResolvedValue({ batchJobRunList: [] });

    await useBatchJobAdminService().getBatchJob(100);
    await useBatchJobAdminService().getBatchJobRunList(100);

    expect(clearAllNotificationsMock).not.toHaveBeenCalled();
  });

  it('starts a batch job run', async () => {
    await useBatchJobAdminService().runBatchJob(100);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/batch-job/100/run', RequestType.POST, {
      ...TOKEN_OPTIONS,
      response: BatchJobRunDto,
    });
  });

  it('hands a failure to the error service', async () => {
    makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.NOT_FOUND));

    await expect(useBatchJobAdminService().getBatchJob(100)).rejects.toThrow();

    expect(handleErrorMock).toHaveBeenCalled();
    expect(clearAllNotificationsMock).not.toHaveBeenCalled();
  });
});
