import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { migrations, testMigrations } from '@/database/migrations';
import { sqliteConnectionOptions } from '@/database/sqlite-connection-options';

/**
 * Migrates a fresh database file for this run. Each worker copies it rather than sharing it: TypeORM opens SQLite
 * transactions DEFERRED, and a second process writing meanwhile fails the upgrade to a write with SQLITE_BUSY.
 */
export default async function setup(): Promise<() => void> {
  const directory = mkdtempSync(join(tmpdir(), 'foxden-int-'));
  const databasePath = join(directory, 'template.sqlite');

  const dataSource = new DataSource({
    ...sqliteConnectionOptions(databasePath),
    migrations: [...migrations, ...testMigrations],
  });

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }

  process.env.INTEGRATION_DATABASE_TEMPLATE = databasePath;

  return () => {
    rmSync(directory, { recursive: true, force: true });
  };
}
