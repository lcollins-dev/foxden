import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { BatchJobService } from '@/core/batch-job/batch-job.service';
import { DatabaseBackupService } from '@/database/database-backup.service';

import { BackupDatabaseJob } from '@/core/backup/backup-database.job';

const buildJob = (backup: ReturnType<typeof vi.fn>) =>
  new BackupDatabaseJob(
    { backupPath: '/data/backups', backupRetention: 7 } as ConfigService,
    {} as BatchJobService,
    { backup } as unknown as DatabaseBackupService
  );

describe('BackupDatabaseJob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a failed backup as an error and fails the run', async () => {
    const error = new Error('disk full');
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(buildJob(vi.fn().mockRejectedValue(error)).run()).rejects.toBe(error);

    expect(logError).toHaveBeenCalledWith(
      { directory: '/data/backups', error },
      'run(): Failed to back up the database'
    );
  });
});
