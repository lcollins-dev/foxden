import { Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backupFileName, DatabaseBackupService } from './database-backup.service';

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 3, 23));

describe('DatabaseBackupService', () => {
  let root: string;
  let directory: string;
  let db: Database.Database;
  let service: DatabaseBackupService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'foxden-backup-'));
    directory = join(root, 'data', 'backups');

    db = new Database(':memory:');
    db.exec("CREATE TABLE account (email TEXT); INSERT INTO account VALUES ('a@foxden.test')");

    service = serviceFor(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const serviceFor = (database: Database.Database) => {
    const driver = Object.create(BetterSqlite3Driver.prototype) as BetterSqlite3Driver;
    driver.databaseConnection = database;

    return new DatabaseBackupService({ driver } as unknown as DataSource);
  };

  const backups = () => readdirSync(directory).sort();

  it('names backups so they sort in the order they were taken', () => {
    expect(backupFileName(at(2))).toBe('foxden-2026-10-02T03-23-00-000Z.sqlite');
    expect([backupFileName(at(10)), backupFileName(at(9))].sort()).toEqual([
      backupFileName(at(9)),
      backupFileName(at(10)),
    ]);
  });

  it('copies the database into a directory only the server user can open', async () => {
    const { file } = await service.backup(directory, 7, at(2));

    expect(file).toBe(join(directory, 'foxden-2026-10-02T03-23-00-000Z.sqlite'));
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const copy = new Database(file, { readonly: true });

    try {
      expect(copy.prepare('SELECT email FROM account').all()).toEqual([{ email: 'a@foxden.test' }]);
    } finally {
      copy.close();
    }
  });

  it('deletes the oldest backups beyond the retention, and nothing else in the directory', async () => {
    for (const day of [1, 2, 3]) {
      await service.backup(directory, 7, at(day));
    }

    writeFileSync(join(directory, 'notes.txt'), '');
    writeFileSync(join(directory, 'foxden.sqlite'), '');

    const { deleted } = await service.backup(directory, 2, at(4));

    expect(deleted).toEqual([join(directory, backupFileName(at(1))), join(directory, backupFileName(at(2)))]);
    expect(backups()).toEqual([backupFileName(at(3)), backupFileName(at(4)), 'foxden.sqlite', 'notes.txt']);
  });

  it('keeps the backup just taken when the clock was set back', async () => {
    await service.backup(directory, 1, at(10));

    await service.backup(directory, 1, at(9));

    expect(backups()).toEqual([backupFileName(at(9))]);
  });

  it('prunes backups dated by a clock that ran ahead before those taken since it was put back', async () => {
    for (const day of [8, 9, 10]) {
      await service.backup(directory, 3, at(day));
    }

    await service.backup(directory, 3, at(5));
    expect(backups()).toEqual([5, 9, 10].map(day => backupFileName(at(day))));

    await service.backup(directory, 3, at(6));
    await service.backup(directory, 3, at(7));
    expect(backups()).toEqual([5, 6, 7].map(day => backupFileName(at(day))));
  });

  it('deletes the files opening a backup leaves beside it along with the backup', async () => {
    await service.backup(directory, 1, at(1));
    writeFileSync(join(directory, `${backupFileName(at(1))}-wal`), '');
    writeFileSync(join(directory, `${backupFileName(at(1))}-shm`), '');

    await service.backup(directory, 1, at(2));

    expect(backups()).toEqual([backupFileName(at(2))]);
  });

  it('logs an old backup it cannot delete and keeps the one just taken', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mkdirSync(join(directory, backupFileName(at(1))), { recursive: true });

    const { file, deleted } = await service.backup(directory, 1, at(2));

    expect(file).toBe(join(directory, backupFileName(at(2))));
    expect(deleted).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ file: join(directory, backupFileName(at(1))) }),
      'prune(): Failed to delete an old backup'
    );
  });

  it('deletes the partial file and journal an interrupted backup left', async () => {
    await service.backup(directory, 7, at(1));
    writeFileSync(join(directory, `${backupFileName(at(2))}.partial`), '');
    writeFileSync(join(directory, `${backupFileName(at(2))}.partial-journal`), '');

    await service.backup(directory, 7, at(3));

    expect(backups()).toEqual([backupFileName(at(1)), backupFileName(at(3))]);
  });

  it('leaves no partial file and keeps earlier backups when a backup fails', async () => {
    await service.backup(directory, 1, at(1));

    vi.spyOn(db, 'backup').mockImplementation(destination => {
      writeFileSync(destination, 'half a database');

      return Promise.reject(new Error('disk full'));
    });

    await expect(service.backup(directory, 1, at(2))).rejects.toThrow('disk full');

    expect(backups()).toEqual([backupFileName(at(1))]);
  });
});
