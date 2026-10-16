import { NestExpressApplication } from '@nestjs/platform-express';
import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { beforeAll, describe, expect, it } from 'vitest';

import { BatchJobId, UserRoleId } from '@libs/dto';

import { ConfigService } from '@/config/config.service';

import { getBatchJob } from '../../clients/batch-job.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { IStorageCredentials, mintStorageCredentials, storageRequest } from '../../utils/hawk';
import { BackupDatabaseJob } from '@/core/backup/backup-database.job';

const BATCHES = 10;
const BSOS_PER_BATCH = 100;
const PAYLOAD = 'x'.repeat(2000);
const OPEN_TRANSACTION_JOB_ID = 997;

describe('Database backup job (integration)', () => {
  let app: NestExpressApplication;
  let credentials: IStorageCredentials;

  beforeAll(async () => {
    app = await bootstrapApp();
    credentials = await mintStorageCredentials(app);
  });

  const postBatch = (batch: number) =>
    storageRequest(app, credentials, 'post', '/storage/history')
      .set('Content-Type', 'text/plain')
      .send(
        JSON.stringify(
          Array.from({ length: BSOS_PER_BATCH }, (_, index) => ({ id: `${batch}-${index}`, payload: PAYLOAD }))
        )
      );

  const inLatestBackup = <T>(query: (backup: Database.Database) => T): T => {
    const directory = app.get(ConfigService).backupPath;
    const [latest] = readdirSync(directory)
      .filter(name => name.endsWith('.sqlite'))
      .sort()
      .reverse();
    const backup = new Database(join(directory, latest), { readonly: true });

    try {
      return query(backup);
    } finally {
      backup.close();
    }
  };

  it('is registered on its configured schedule and switched on', async () => {
    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    const token = await login(app, admin.email);

    const response = await getBatchJob(app, token, BatchJobId.BACKUP_DATABASE).expect(200);

    expect(response.body).toMatchObject({
      cronExpression: app.get(ConfigService).batchJobBackupDatabaseCron,
      enabled: true,
    });
  });

  it('writes a consistent copy of the synced data', async () => {
    for (let batch = 0; batch < BATCHES; batch++) {
      await postBatch(batch).expect(200);
    }

    await app.get(BackupDatabaseJob).run();

    inLatestBackup(backup => {
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(backup.prepare('SELECT COUNT(*) AS count FROM storage_bso WHERE uid = ?').get(credentials.uid)).toEqual({
        count: BATCHES * BSOS_PER_BATCH,
      });
    });
  });

  it("waits out another request's open write transaction, and keeps what it committed", async () => {
    let commit = (): void => undefined;
    const committed = new Promise<void>(resolve => (commit = resolve));
    let inserted = (): void => undefined;
    const insertedRow = new Promise<void>(resolve => (inserted = resolve));

    const transaction = app.get(DataSource).transaction(async manager => {
      await manager.query('INSERT INTO batch_job (id, "name", "desc", enabled) VALUES (?, ?, ?, 0)', [
        OPEN_TRANSACTION_JOB_ID,
        'Open transaction',
        'Written inside a transaction a backup meets',
      ]);
      inserted();

      await committed;
    });

    try {
      await insertedRow;

      let settled = false;
      const backup = app
        .get(BackupDatabaseJob)
        .run()
        .finally(() => {
          settled = true;
        });
      await setTimeout(250);

      expect(settled).toBe(false);
      commit();

      await transaction;
      await backup;

      inLatestBackup(copy => {
        expect(copy.prepare('SELECT id FROM batch_job WHERE id = ?').get(OPEN_TRANSACTION_JOB_ID)).toEqual({
          id: OPEN_TRANSACTION_JOB_ID,
        });
      });
    } finally {
      commit();
      await transaction;
      await dbQuery(app, 'DELETE FROM batch_job WHERE id = ?', [OPEN_TRANSACTION_JOB_ID]);
    }
  });
});
