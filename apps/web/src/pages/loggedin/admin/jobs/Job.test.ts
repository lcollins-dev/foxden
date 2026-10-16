import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobRunResult, type BatchJobDto, type BatchJobRunDto } from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Job from './Job.vue';

const mocks = vi.hoisted(() => ({
  getBatchJob: vi.fn(),
  getBatchJobRunList: vi.fn(),
  updateBatchJobState: vi.fn(),
  runBatchJob: vi.fn(),
}));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { batchJobId: '110' } }),
}));

vi.mock('@/services/api/admin/BatchJobAdminService', () => ({
  useBatchJobAdminService: () => mocks,
}));

const POLL_MS = 2000;

const BATCH_JOB: BatchJobDto = {
  id: 110,
  name: 'Purge expired sessions',
  desc: 'Deletes sessions past their expiry',
  cronExpression: '0 * * * *',
  enabled: true,
  lastStartDate: null,
  lastSuccessDate: null,
  lastFailDate: null,
};

const buildRun = (result: BatchJobRunResult): BatchJobRunDto => ({
  id: 4,
  startDate: new Date('2026-10-02T13:47:00Z'),
  endDate: result === BatchJobRunResult.RUNNING ? null : new Date('2026-10-02T13:47:03Z'),
  result,
  error: null,
});

const runsResponse = (...runs: BatchJobRunDto[]) => ({ batchJobRunList: runs });

const mountPage = async () => {
  const wrapper = mount(Job, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });

  await flushPromises();

  return wrapper;
};

const confirmDialog = async () => {
  const dialogStore = useDialogStore();
  const dialog = dialogStore.top!;

  await dialog.options.action?.();
  dialogStore.close(dialog, true);
};

const runNow = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
  await wrapper.get('[data-testid="job-run-now"]').trigger('click');
  await confirmDialog();
};

const runRows = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('[data-testid="job-run"]');

describe('Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());

    mocks.getBatchJob.mockResolvedValue(BATCH_JOB);
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks before running, then lists the run as running', async () => {
    mocks.runBatchJob.mockResolvedValue(buildRun(BatchJobRunResult.RUNNING));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="job-run-now"]').trigger('click');

    expect(useDialogStore().top?.options.title).toBe('Run Purge expired sessions now?');
    expect(mocks.runBatchJob).not.toHaveBeenCalled();

    await confirmDialog();
    await flushPromises();

    expect(mocks.runBatchJob).toHaveBeenCalledWith(110);
    expect(runRows(wrapper)).toHaveLength(1);
    expect(runRows(wrapper)[0].text()).toContain('Running');
  });

  it('reloads the job and its runs while a run is going, and stops once it has finished', async () => {
    mocks.runBatchJob.mockResolvedValue(buildRun(BatchJobRunResult.RUNNING));
    const wrapper = await mountPage();

    await runNow(wrapper);
    await flushPromises();

    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(2);

    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.SUCCEEDED)));
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(3);
    expect(runRows(wrapper)[0].text()).toContain('Succeeded');

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(3);
  });

  it('follows a run that was already going when the page opened', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await mountPage();

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(2);
  });

  it('stops reloading when the page closes', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    const wrapper = await mountPage();

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(1);
  });

  it('stops reloading when the page closes while a reload is answering', async () => {
    let answerRuns: (response: ReturnType<typeof runsResponse>) => void = () => undefined;
    mocks.getBatchJobRunList.mockReturnValue(
      new Promise(resolve => {
        answerRuns = resolve;
      })
    );
    const wrapper = await mountPage();

    wrapper.unmount();
    answerRuns(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(1);
  });

  it('keeps following a run through a failed reload', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await mountPage();

    mocks.getBatchJobRunList.mockRejectedValueOnce(new Error('Network Error'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJob).toHaveBeenCalledTimes(3);
  });

  it('changes the schedule state and toasts it', async () => {
    mocks.updateBatchJobState.mockResolvedValue(undefined);
    const wrapper = await mountPage();

    await wrapper.get('[role="switch"]').trigger('click');
    await flushPromises();

    expect(mocks.updateBatchJobState).toHaveBeenCalledWith({ enabled: false }, 110);
    expect(useNotificationStore().notifications).toEqual([expect.objectContaining({ title: 'Job disabled' })]);
  });

  it('rejects the dialog action and lists no run when the run is refused', async () => {
    const refusal = new Error('This batch job is already running');
    mocks.runBatchJob.mockRejectedValue(refusal);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="job-run-now"]').trigger('click');

    await expect(useDialogStore().top?.options.action?.()).rejects.toThrow(refusal);
    expect(runRows(wrapper)).toHaveLength(0);
  });
});
