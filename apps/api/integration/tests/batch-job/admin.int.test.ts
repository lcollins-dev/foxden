import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DateUtils } from 'typeorm/util/DateUtils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BatchJobId, BatchJobRunResult, BatchJobDto, BatchJobRunDto, UserRoleId } from '@libs/dto';

import {
  getBatchJob,
  getBatchJobList,
  getBatchJobRunList,
  runBatchJob,
  updateBatchJobState,
} from '../../clients/batch-job.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const BATCH_JOB_LIST_ROUTE = '/api/v1/admin/batch-job/list';
const UNREGISTERED_JOB_ID = 999;
const HISTORY_JOB_ID = BatchJobId.PURGE_EXPIRED_SESSIONS;
const HISTORY_SIZE = 100;
const SUCCEEDED_HISTORY_SIZE = 10;
const AWAIT_RUN_OPTIONS = { timeout: 10_000, interval: 100 };

describe('Batch job admin routes (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  const awaitRunClosed = (runId: number): Promise<BatchJobRunDto> =>
    vi.waitFor(async () => {
      const response = await getBatchJobRunList(app, token, HISTORY_JOB_ID).expect(200);
      const runs: BatchJobRunDto[] = response.body.batchJobRunList;
      const run = runs.find(batchJobRun => batchJobRun.id === runId);

      if (!run || run.result === BatchJobRunResult.RUNNING) {
        throw new Error(`Run ${runId} is still open`);
      }

      return run;
    }, AWAIT_RUN_OPTIONS);

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    token = await login(app, admin.email);
  });

  afterAll(async () => {
    // This hook runs even when beforeAll failed before assigning app, so it resolves the
    // shared app itself rather than reading a variable that may never have been set.
    await dbQuery(await bootstrapApp(), 'UPDATE batch_job SET enabled = 1 WHERE id = ?', [
      BatchJobId.PURGE_EXPIRED_SYNC_DATA,
    ]);
  });

  describe('access', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get(BATCH_JOB_LIST_ROUTE).expect(401);
    });

    it('rejects a user with no roles', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getBatchJobList(app, userToken).expect(401);
    });

    it('rejects a USER_ADMIN who is not a SYSTEM_ADMIN', async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await getBatchJobList(app, adminToken).expect(401);
    });

    it("rejects a USER_ADMIN reading a job's runs", async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await getBatchJobRunList(app, adminToken, HISTORY_JOB_ID).expect(401);
    });

    it('rejects a USER_ADMIN running a job', async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await runBatchJob(app, adminToken, HISTORY_JOB_ID).expect(401);
    });
  });

  describe('reading', () => {
    it('lists the seeded purge job', async () => {
      const response = await getBatchJobList(app, token).expect(200);

      const ids = response.body.batchJobList.map((batchJob: BatchJobDto) => batchJob.id);

      expect(ids).toContain(BatchJobId.PURGE_EXPIRED_SYNC_DATA);
    });

    it('returns a single job with its schedule and run history', async () => {
      const response = await getBatchJob(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA).expect(200);

      expect(response.body).toMatchObject({
        id: BatchJobId.PURGE_EXPIRED_SYNC_DATA,
        enabled: expect.any(Boolean) as boolean,
      });
      expect(response.body).toHaveProperty('cronExpression');
      expect(response.body).toHaveProperty('lastStartDate');
      expect(response.body).toHaveProperty('lastSuccessDate');
      expect(response.body).toHaveProperty('lastFailDate');
    });

    it('rejects a job id that does not exist', async () => {
      await getBatchJob(app, token, 2147483647).expect(400);
    });

    it('rejects a job id that is not an integer', async () => {
      await getBatchJob(app, token, 'abc').expect(400);
    });
  });

  describe('updating state', () => {
    it('disables and re-enables the job', async () => {
      await updateBatchJobState(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA, { enabled: false }).expect(200);

      const disabled = await getBatchJob(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA).expect(200);
      expect(disabled.body.enabled).toBe(false);

      await updateBatchJobState(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA, { enabled: true }).expect(200);

      const enabled = await getBatchJob(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA).expect(200);
      expect(enabled.body.enabled).toBe(true);
    });

    it('rejects a non-boolean enabled flag', async () => {
      await updateBatchJobState(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA, { enabled: 'yes' }).expect(400);
    });

    it('rejects a missing enabled flag', async () => {
      await updateBatchJobState(app, token, BatchJobId.PURGE_EXPIRED_SYNC_DATA, {}).expect(400);
    });

    it('rejects a job id that does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/admin/batch-job/2147483647/state')
        .set(authHeaders(token))
        .send({ enabled: false })
        .expect(400);
    });
  });

  describe('running now', () => {
    it('answers 202 with the run it opened, which the run list then closes', async () => {
      const response = await runBatchJob(app, token, HISTORY_JOB_ID).expect(202);

      expect(response.body).toEqual({
        id: expect.any(Number) as number,
        startDate: expect.any(String) as string,
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });

      const finished = await awaitRunClosed(response.body.id);
      expect(finished.result).toBe(BatchJobRunResult.SUCCEEDED);
    });

    it('runs a disabled job and leaves it disabled', async () => {
      await updateBatchJobState(app, token, HISTORY_JOB_ID, { enabled: false }).expect(200);

      try {
        const response = await runBatchJob(app, token, HISTORY_JOB_ID).expect(202);

        const finished = await awaitRunClosed(response.body.id);
        expect(finished.result).toBe(BatchJobRunResult.SUCCEEDED);

        const job = await getBatchJob(app, token, HISTORY_JOB_ID).expect(200);
        expect(job.body.enabled).toBe(false);
      } finally {
        await updateBatchJobState(app, token, HISTORY_JOB_ID, { enabled: true }).expect(200);
      }
    });

    it('rejects a job that has no cron job registered', async () => {
      await dbQuery(app, 'INSERT INTO batch_job (id, "name", "desc", enabled) VALUES (?, ?, ?, 1)', [
        UNREGISTERED_JOB_ID,
        'Unregistered',
        'A job with no cron job behind it',
      ]);

      try {
        const response = await runBatchJob(app, token, UNREGISTERED_JOB_ID).expect(400);

        expect(response.body.message).toBe('This batch job has not been registered');
      } finally {
        await dbQuery(app, 'DELETE FROM batch_job WHERE id = ?', [UNREGISTERED_JOB_ID]);
      }
    });

    it('rejects a job id that does not exist', async () => {
      await runBatchJob(app, token, 2147483647).expect(400);
    });
  });

  describe('run history', () => {
    const runCount = async (result: BatchJobRunResult): Promise<number> => {
      const [row] = await dbQuery<{ count: number }>(
        app,
        'SELECT COUNT(*) AS count FROM batch_job_run WHERE "batchJobId" = ? AND "result" = ?',
        [HISTORY_JOB_ID, result]
      );

      return row.count;
    };

    const listRuns = async (): Promise<BatchJobRunDto[]> => {
      const response = await getBatchJobRunList(app, token, HISTORY_JOB_ID).expect(200);

      return response.body.batchJobRunList;
    };

    const runAndListRuns = async (): Promise<BatchJobRunDto[]> => {
      const response = await runBatchJob(app, token, HISTORY_JOB_ID).expect(202);
      await awaitRunClosed(response.body.id);

      return listRuns();
    };

    it('records each run with its start, end and result, newest first', async () => {
      const [first] = await runAndListRuns();
      const runs = await runAndListRuns();

      expect(runs[0]).toEqual({
        id: expect.any(Number) as number,
        startDate: expect.any(String) as string,
        endDate: expect.any(String) as string,
        result: BatchJobRunResult.SUCCEEDED,
        error: null,
      });
      expect(runs.findIndex(run => run.id === first.id)).toBeGreaterThan(0);
      expect(new Date(runs[0].startDate).getTime()).toBeGreaterThanOrEqual(new Date(runs[1].startDate).getTime());
      expect(new Date(runs[0].endDate ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(runs[0].startDate).getTime());

      const job = await getBatchJob(app, token, HISTORY_JOB_ID).expect(200);
      expect(new Date(job.body.lastSuccessDate).getTime()).toBe(new Date(runs[0].endDate ?? 0).getTime());
    });

    it('keeps the last 10 succeeded runs and the history size of failed ones', async () => {
      await dbQuery(app, 'DELETE FROM batch_job_run WHERE "batchJobId" = ?', [HISTORY_JOB_ID]);

      const utc = (date: Date): string => DateUtils.mixedDateToUtcDatetimeString(date);

      for (let minute = 0; minute < HISTORY_SIZE + 5; minute++) {
        const failedAt = utc(new Date(Date.UTC(2020, 0, 1, 0, minute)));
        const succeededAt = utc(new Date(Date.UTC(2021, 0, 1, 0, minute)));

        await dbQuery(
          app,
          'INSERT INTO batch_job_run ("batchJobId", "startDate", "endDate", "result") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
          [
            HISTORY_JOB_ID,
            failedAt,
            failedAt,
            BatchJobRunResult.FAILED,
            HISTORY_JOB_ID,
            succeededAt,
            succeededAt,
            BatchJobRunResult.SUCCEEDED,
          ]
        );
      }

      await runAndListRuns();

      expect(await runCount(BatchJobRunResult.SUCCEEDED)).toBe(SUCCEEDED_HISTORY_SIZE);
      expect(await runCount(BatchJobRunResult.FAILED)).toBe(HISTORY_SIZE + 5);

      // The job never fails here, so a run left open is what adds a failure, as the next run starts.
      await dbQuery(app, 'INSERT INTO batch_job_run ("batchJobId", "startDate", "result") VALUES (?, ?, ?)', [
        HISTORY_JOB_ID,
        utc(new Date(Date.UTC(2022, 0, 1))),
        BatchJobRunResult.RUNNING,
      ]);

      const runs = await runAndListRuns();

      expect(await runCount(BatchJobRunResult.SUCCEEDED)).toBe(SUCCEEDED_HISTORY_SIZE);
      expect(await runCount(BatchJobRunResult.FAILED)).toBe(HISTORY_SIZE);
      expect(runs).toHaveLength(SUCCEEDED_HISTORY_SIZE + HISTORY_SIZE);

      // 105 seeded failures plus the interrupted run, so the six oldest go.
      expect(new Date(runs[runs.length - 1].startDate).toISOString()).toBe(
        new Date(Date.UTC(2020, 0, 1, 0, 6)).toISOString()
      );
    });
  });
});
