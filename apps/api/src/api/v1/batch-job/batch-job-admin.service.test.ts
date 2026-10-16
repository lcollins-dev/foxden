import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJobRun } from '@/core/batch-job/entities/batch-job-run.entity';
import { BatchJob } from '@/core/batch-job/entities/batch-job.entity';

import { BatchJobAdminService } from '@/api/v1/batch-job/batch-job-admin.service';
import { BatchJobService } from '@/core/batch-job/batch-job.service';

const buildBatchJob = (overrides: Partial<BatchJob> = {}): BatchJob => {
  const batchJob = new BatchJob({
    id: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
    name: 'Example',
    desc: 'An example job',
    enabled: true,
  });

  batchJob.cronExpression = '0 * * * *';

  Object.assign(batchJob, overrides);

  return batchJob;
};

describe('BatchJobAdminService', () => {
  let batchJobAdminService: BatchJobAdminService;
  let batchJobService: {
    findAll: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    findRuns: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
    runNow: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    batchJobService = {
      findAll: vi.fn().mockResolvedValue([]),
      findWithThrow: vi.fn().mockResolvedValue(buildBatchJob()),
      findRuns: vi.fn().mockResolvedValue([]),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      runNow: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [BatchJobAdminService, { provide: BatchJobService, useValue: batchJobService }],
    }).compile();

    batchJobAdminService = moduleRef.get(BatchJobAdminService);
  });

  describe('getBatchJob', () => {
    it('reads the row down to what a caller needs', async () => {
      const batchJob = await batchJobAdminService.getBatchJob(BatchJobId.PURGE_EXPIRED_SYNC_DATA);

      expect(batchJob).toEqual({
        id: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
        name: 'Example',
        desc: 'An example job',
        cronExpression: '0 * * * *',
        enabled: true,
        lastStartDate: null,
        lastSuccessDate: null,
        lastFailDate: null,
      });
    });

    it('throws when the job does not exist', async () => {
      batchJobService.findWithThrow.mockRejectedValue(new BadRequestException());

      await expect(batchJobAdminService.getBatchJob(BatchJobId.PURGE_EXPIRED_SYNC_DATA)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('getBatchJobList', () => {
    it('reads every job the domain holds', async () => {
      batchJobService.findAll.mockResolvedValue([buildBatchJob()]);

      const response = await batchJobAdminService.getBatchJobList();

      expect(response.batchJobList).toHaveLength(1);
      expect(response.batchJobList[0].id).toBe(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
    });

    it('answers with an empty list where there are no jobs', async () => {
      const response = await batchJobAdminService.getBatchJobList();

      expect(response.batchJobList).toEqual([]);
    });
  });

  describe('getBatchJobRunList', () => {
    it('reads each run down to what a caller needs, in the order the domain gives', async () => {
      const failed = new BatchJobRun({
        batchJobId: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
        startDate: new Date('2026-10-02T13:47:00Z'),
      });
      Object.assign(failed, {
        id: 2,
        endDate: new Date('2026-10-02T13:47:12Z'),
        result: BatchJobRunResult.FAILED,
        error: 'database is locked',
      });

      const running = new BatchJobRun({
        batchJobId: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
        startDate: new Date('2026-10-02T14:47:00Z'),
      });
      Object.assign(running, { id: 3 });

      batchJobService.findRuns.mockResolvedValue([running, failed]);

      const response = await batchJobAdminService.getBatchJobRunList(BatchJobId.PURGE_EXPIRED_SYNC_DATA);

      expect(batchJobService.findRuns).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
      expect(response.batchJobRunList).toEqual([
        {
          id: 3,
          startDate: new Date('2026-10-02T14:47:00Z'),
          endDate: null,
          result: BatchJobRunResult.RUNNING,
          error: null,
        },
        {
          id: 2,
          startDate: new Date('2026-10-02T13:47:00Z'),
          endDate: new Date('2026-10-02T13:47:12Z'),
          result: BatchJobRunResult.FAILED,
          error: 'database is locked',
        },
      ]);
    });
  });

  describe('the commands it passes on', () => {
    it('changes state through the domain', async () => {
      await batchJobAdminService.updateBatchJobState(BatchJobId.PURGE_EXPIRED_SYNC_DATA, false);

      expect(batchJobService.setEnabled).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA, false);
    });

    it('starts the job through the domain and answers the run it opened', async () => {
      const run = new BatchJobRun({
        batchJobId: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
        startDate: new Date('2026-10-02T13:47:00Z'),
      });
      run.id = 4;
      batchJobService.runNow.mockResolvedValue(run);

      const response = await batchJobAdminService.runBatchJob(BatchJobId.PURGE_EXPIRED_SYNC_DATA);

      expect(batchJobService.runNow).toHaveBeenCalledWith(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
      expect(response).toEqual({
        id: 4,
        startDate: new Date('2026-10-02T13:47:00Z'),
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });
    });
  });
});
