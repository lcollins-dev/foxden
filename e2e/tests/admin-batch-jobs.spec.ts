import { randomUUID } from 'node:crypto';

import { getBatchJobEnabled, setBatchJobEnabled } from '../clients/admin.client';
import { expect, test } from '../fixtures/test';
import { addFailedBatchJobRun, deleteBatchJobRun } from '../utils/db';

const PURGE_BATCH_JOB_ID = 100;
const PURGE_BATCH_JOB_NAME = 'Purge expired sync data';
// No other spec reads this job's runs, so a run started here cannot reorder theirs.
const SESSIONS_BATCH_JOB_ID = 110;

test.describe('background jobs', () => {
  test('lists the registered jobs and opens one', async ({ adminBatchJobsPage, adminBatchJobPage, page }) => {
    await adminBatchJobsPage.goto();

    await expect(adminBatchJobsPage.heading).toBeVisible();

    await adminBatchJobsPage.rowByName(PURGE_BATCH_JOB_NAME).getByText(PURGE_BATCH_JOB_NAME).click();

    await expect(page).toHaveURL(new RegExp(`/admin/jobs/${PURGE_BATCH_JOB_ID}$`));
    await expect(adminBatchJobPage.state).toBeVisible();
  });

  test("lists a run and shows a failed run's error on expand", async ({ adminBatchJobPage }) => {
    const error = `e2e failure ${randomUUID()}`;
    const batchJobRunId = addFailedBatchJobRun(PURGE_BATCH_JOB_ID, error);

    try {
      await adminBatchJobPage.goto(PURGE_BATCH_JOB_ID);

      const run = adminBatchJobPage.runs.first();

      await expect(run).toContainText('Failed');
      await expect(adminBatchJobPage.runError(run)).toBeHidden();

      await run.getByRole('button', { name: 'Show the error' }).click();

      await expect(adminBatchJobPage.runError(run)).toHaveText(error);
    } finally {
      deleteBatchJobRun(batchJobRunId);
    }
  });

  test('runs a job now and follows the run to its result without a reload', async ({ adminBatchJobPage }) => {
    await adminBatchJobPage.goto(SESSIONS_BATCH_JOB_ID);
    await expect(adminBatchJobPage.runs.first().or(adminBatchJobPage.noRuns)).toBeVisible();

    await adminBatchJobPage.runNow.click();
    await adminBatchJobPage.confirmRunNow.click();

    await expect(adminBatchJobPage.runs.first()).toContainText('Running');
    await expect(adminBatchJobPage.runs.first()).toContainText('Succeeded', { timeout: 10_000 });
  });

  // The seeded job is shared. Its state is captured and put back around the one test that
  // drives it, whether or not the assertions in between ran; specs run fully parallel, so
  // tests that only read it stay outside these hooks.
  test.describe('driving the job state', () => {
    let initialEnabled: boolean;

    test.beforeEach(async ({ request }) => {
      initialEnabled = await getBatchJobEnabled(request, PURGE_BATCH_JOB_ID);
    });

    test.afterEach(async ({ request }) => {
      await setBatchJobEnabled(request, PURGE_BATCH_JOB_ID, initialEnabled);
    });

    test('disables and re-enables a job', async ({ adminBatchJobPage, page, request }) => {
      await setBatchJobEnabled(request, PURGE_BATCH_JOB_ID, true);

      await adminBatchJobPage.goto(PURGE_BATCH_JOB_ID);
      await expect(adminBatchJobPage.state).toHaveText('Enabled');

      await adminBatchJobPage.toggle.click();

      await expect(page.getByText('Job disabled')).toBeVisible();
      await expect(adminBatchJobPage.state).toHaveText('Disabled');

      await adminBatchJobPage.toggle.click();

      await expect(page.getByText('Job enabled')).toBeVisible();
      await expect(adminBatchJobPage.state).toHaveText('Enabled');
    });
  });
});
