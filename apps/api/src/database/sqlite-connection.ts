import Database from 'better-sqlite3';
import { DataSource } from 'typeorm';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';

export type SqliteDatabase = Database.Database;

/** The one better-sqlite3 connection TypeORM opened, which every query in the process shares. */
export const sqliteConnection = (dataSource: DataSource): SqliteDatabase => {
  const driver = dataSource.driver;

  if (!(driver instanceof BetterSqlite3Driver) || !(driver.databaseConnection instanceof Database)) {
    throw new Error('Expected the better-sqlite3 driver');
  }

  return driver.databaseConnection;
};
