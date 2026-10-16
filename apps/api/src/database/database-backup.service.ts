import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DataSource } from 'typeorm';

import { connectionGate } from './connection-gate';
import { sqliteConnection } from './sqlite-connection';

// A backup holds the access token signing key, which the database keeps, so only the server's user may read one.
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

const TAKEN_AT = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;
const BACKUP_FILE_PATTERN = new RegExp(String.raw`^foxden-${TAKEN_AT}\.sqlite$`);
// A backup cut short leaves its partial file and SQLite's rollback journal for it.
const PARTIAL_FILE_PATTERN = new RegExp(String.raw`^foxden-${TAKEN_AT}\.sqlite\.partial(-journal)?$`);
// Opening a backup, which keeps the database's WAL mode, leaves these beside it.
const SIDECAR_SUFFIXES = ['-wal', '-shm'];

/** Sorts by name in the order the backups were taken. */
export const backupFileName = (takenAt: Date): string => `foxden-${takenAt.toISOString().replace(/[:.]/g, '-')}.sqlite`;

export interface IDatabaseBackup {
  file: string;
  deleted: string[];
}

/**
 * Copies the database with SQLite's online backup API on TypeORM's connection, 100 pages per event-loop turn, holding
 * the connection gate meanwhile so no transaction opens mid-copy.
 */
@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Writes a backup into `directory`, then deletes the oldest backups there beyond `retention` and any partial file an
   * interrupted backup left. A failed deletion is logged and leaves the backup taken. Call it for one directory at a
   * time.
   */
  async backup(directory: string, retention: number, takenAt: Date): Promise<IDatabaseBackup> {
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });

    const file = join(directory, backupFileName(takenAt));
    const partialFile = `${file}.partial`;

    try {
      // Created first, so SQLite writes the copy and its journal with this mode from the start.
      await writeFile(partialFile, '', { mode: FILE_MODE, flag: 'wx' });
      await this.copyInto(partialFile);
      await rename(partialFile, file);
    } catch (error) {
      await rm(partialFile, { force: true });

      throw error;
    }

    const deleted = await this.prune(directory, file, retention);

    this.logger.log({ file, deleted }, 'backup(): Backed up the database');

    return { file, deleted };
  }

  /**
   * No transaction may open during the copy. A step that met one would get SQLITE_BUSY, which better-sqlite3 retries
   * without pause, or on the first step reads as a finished copy of no pages.
   */
  private async copyInto(partialFile: string): Promise<void> {
    const db = sqliteConnection(this.dataSource);
    const { totalPages } = await connectionGate.transaction(() => db.backup(partialFile));

    if (totalPages === 0) {
      throw new Error('The database was inside a transaction that skipped the connection gate');
    }
  }

  /**
   * Keeps `newest` whatever its name sorts as. A backup named later than it was taken before the clock went back, so it
   * counts as older than every other.
   */
  private async prune(directory: string, newest: string, retention: number): Promise<string[]> {
    const names = await readdir(directory);
    const newestName = basename(newest);

    const older = names.filter(name => BACKUP_FILE_PATTERN.test(name) && name !== newestName);
    const oldestFirst = [
      ...older.filter(name => name > newestName).sort(),
      ...older.filter(name => name < newestName).sort(),
    ];
    const expiredBackups = oldestFirst.slice(0, Math.max(0, oldestFirst.length - (retention - 1)));
    const partials = names.filter(name => PARTIAL_FILE_PATTERN.test(name));

    const deleted: string[] = [];

    for (const name of [...expiredBackups, ...partials]) {
      const file = join(directory, name);

      try {
        await rm(file, { force: true });

        for (const suffix of SIDECAR_SUFFIXES) {
          await rm(`${file}${suffix}`, { force: true });
        }

        deleted.push(file);
      } catch (error) {
        this.logger.error({ file, error }, 'prune(): Failed to delete an old backup');
      }
    }

    return deleted;
  }
}
