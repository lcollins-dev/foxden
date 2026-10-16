import { Injectable } from '@nestjs/common';

import {
  BatchJobId,
  BatchJobDto,
  BatchJobListResponseDto,
  BatchJobRunDto,
  BatchJobRunListResponseDto,
} from '@libs/dto';

import { BatchJobRun } from '@/core/batch-job/entities/batch-job-run.entity';
import { BatchJob } from '@/core/batch-job/entities/batch-job.entity';

import { BatchJobService } from '@/core/batch-job/batch-job.service';

@Injectable()
export class BatchJobAdminService {
  constructor(private readonly batchJobService: BatchJobService) {}

  async getBatchJob(batchJobId: BatchJobId): Promise<BatchJobDto> {
    return this.getIBatchJob(await this.batchJobService.findWithThrow(batchJobId));
  }

  async getBatchJobList(): Promise<BatchJobListResponseDto> {
    const batchJobList = await this.batchJobService.findAll();

    return {
      batchJobList: batchJobList.map(batchJob => this.getIBatchJob(batchJob)),
    };
  }

  async getBatchJobRunList(batchJobId: BatchJobId): Promise<BatchJobRunListResponseDto> {
    const batchJobRunList = await this.batchJobService.findRuns(batchJobId);

    return {
      batchJobRunList: batchJobRunList.map(batchJobRun => this.getIBatchJobRun(batchJobRun)),
    };
  }

  updateBatchJobState(batchJobId: BatchJobId, enabled: boolean): Promise<void> {
    return this.batchJobService.setEnabled(batchJobId, enabled);
  }

  async runBatchJob(batchJobId: BatchJobId): Promise<BatchJobRunDto> {
    return this.getIBatchJobRun(await this.batchJobService.runNow(batchJobId));
  }

  private getIBatchJob(batchJob: BatchJob): BatchJobDto {
    return {
      id: batchJob.id,
      name: batchJob.name,
      desc: batchJob.desc,
      cronExpression: batchJob.cronExpression,
      enabled: batchJob.enabled,
      lastStartDate: batchJob.lastStartDate,
      lastSuccessDate: batchJob.lastSuccessDate,
      lastFailDate: batchJob.lastFailDate,
    };
  }

  private getIBatchJobRun(batchJobRun: BatchJobRun): BatchJobRunDto {
    return {
      id: batchJobRun.id,
      startDate: batchJobRun.startDate,
      endDate: batchJobRun.endDate,
      result: batchJobRun.result,
      error: batchJobRun.error,
    };
  }
}
