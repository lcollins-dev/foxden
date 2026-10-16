import { Logger } from '@nestjs/common';
import { chmodSync, existsSync } from 'node:fs';
import { BetterSqlite3ConnectionOptions } from 'typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions';

const BUSY_TIMEOUT_MS = 5000;

// The database holds the token signing key and the tokenserver secret, so only the server's user may read it. SQLite
// creates the WAL and shared-memory files with the database file's mode, so these stay private once it is.
const FILE_MODE = 0o600;

const logger = new Logger('SqliteConnection');

// A file the server does not own, as on some bind mounts, keeps its mode rather than stopping the server.
const restrictAccess = (databasePath: string): void => {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!existsSync(path)) {
      continue;
    }

    try {
      chmodSync(path, FILE_MODE);
    } catch (error: unknown) {
      logger.warn({ path, error }, 'restrictAccess(): Could not make the database file private to the server');
    }
  }
};

/**
 * TypeORM creates the file's directory and turns foreign_keys on for every connection itself, and better-sqlite3
 * applies `timeout` as the connection's busy_timeout.
 */
export const sqliteConnectionOptions = (databasePath: string): BetterSqlite3ConnectionOptions => ({
  type: 'better-sqlite3',
  database: databasePath,
  enableWAL: true,
  timeout: BUSY_TIMEOUT_MS,
  prepareDatabase: () => restrictAccess(databasePath),
});
