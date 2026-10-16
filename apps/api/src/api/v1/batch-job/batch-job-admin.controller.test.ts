import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId } from '@libs/dto';

import { BatchJobAdminService } from '@/api/v1/batch-job/batch-job-admin.service';

import { BatchJobAdminController } from '@/api/v1/batch-job/batch-job-admin.controller';

describe('BatchJobAdminController', () => {
  let controller: BatchJobAdminController;
  let getBatchJobMock: ReturnType<typeof vi.fn>;
  let getBatchJobListMock: ReturnType<typeof vi.fn>;
  let getBatchJobRunListMock: ReturnType<typeof vi.fn>;
  let updateBatchJobStateMock: ReturnType<typeof vi.fn>;
  let runBatchJobMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getBatchJobMock = vi.fn();
    getBatchJobListMock = vi.fn();
    getBatchJobRunListMock = vi.fn();
    updateBatchJobStateMock = vi.fn();
    runBatchJobMock = vi.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [BatchJobAdminController],
      providers: [
        {
          provide: BatchJobAdminService,
          useValue: {
            getBatchJob: getBatchJobMock,
            getBatchJobList: getBatchJobListMock,
            getBatchJobRunList: getBatchJobRunListMock,
            updateBatchJobState: updateBatchJobStateMock,
            runBatchJob: runBatchJobMock,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(BatchJobAdminController);
  });

  it('returns the batch job list from the service', async () => {
    getBatchJobListMock.mockResolvedValue({ batchJobList: [] });

    const response = await controller.getBatchJobList();

    expect(response).toEqual({ batchJobList: [] });
  });

  it('passes the parsed id through when fetching a single batch job', async () => {
    getBatchJobMock.mockResolvedValue({ id: BatchJobId.PURGE_EXPIRED_SYNC_DATA });

    await controller.getBatchJob(BatchJobId.PURGE_EXPIRED_SYNC_DATA);

    expect(getBatchJobMock).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
  });

  it("passes the parsed id through when listing a batch job's runs", async () => {
    getBatchJobRunListMock.mockResolvedValue({ batchJobRunList: [] });

    await controller.getBatchJobRunList(BatchJobId.PURGE_EXPIRED_SYNC_DATA);

    expect(getBatchJobRunListMock).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
  });

  it('unwraps the enabled flag from the body when updating state', async () => {
    updateBatchJobStateMock.mockResolvedValue(undefined);

    await controller.updateBatchJobState(BatchJobId.PURGE_EXPIRED_SYNC_DATA, { enabled: false });

    expect(updateBatchJobStateMock).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA, false);
  });

  it('runs the batch job by id and answers the run', async () => {
    runBatchJobMock.mockResolvedValue({ id: 4 });

    await expect(controller.runBatchJob(BatchJobId.PURGE_EXPIRED_SYNC_DATA)).resolves.toEqual({ id: 4 });

    expect(runBatchJobMock).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
  });
});
