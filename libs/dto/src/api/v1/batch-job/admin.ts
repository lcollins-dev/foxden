import { z } from 'zod';

import { flag, requestBody, timestamp } from '../../../fields';

export enum BatchJobId {
  PURGE_EXPIRED_SYNC_DATA = 100,
  PURGE_EXPIRED_SESSIONS = 110,
  BACKUP_DATABASE = 200,
}

export const BatchJobDto = z.object({
  id: z.number(),
  name: z.string(),
  desc: z.string(),
  cronExpression: z.string().nullable(),
  enabled: z.boolean(),
  lastStartDate: timestamp().nullable(),
  lastSuccessDate: timestamp().nullable(),
  lastFailDate: timestamp().nullable(),
});
export type BatchJobDto = z.infer<typeof BatchJobDto>;

export const BatchJobListResponseDto = z.object({
  batchJobList: z.array(BatchJobDto),
});
export type BatchJobListResponseDto = z.infer<typeof BatchJobListResponseDto>;

export enum BatchJobRunResult {
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export const BatchJobRunDto = z.object({
  id: z.number(),
  startDate: timestamp(),
  /** Null while the run is going. */
  endDate: timestamp().nullable(),
  result: z.enum(BatchJobRunResult),
  /** The failure's message, on a failed run only. */
  error: z.string().nullable(),
});
export type BatchJobRunDto = z.infer<typeof BatchJobRunDto>;

export const BatchJobRunListResponseDto = z.object({
  /** Newest first. */
  batchJobRunList: z.array(BatchJobRunDto),
});
export type BatchJobRunListResponseDto = z.infer<typeof BatchJobRunListResponseDto>;

export const UpdateBatchJobStateRequestDto = requestBody({
  enabled: flag(),
});
export type UpdateBatchJobStateRequestDto = z.infer<typeof UpdateBatchJobStateRequestDto>;
