import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { connectionGate, ConnectionGateTimeoutError } from './connection-gate';
import { SqliteDatabase, sqliteConnection } from './sqlite-connection';

export type { SqliteDatabase } from './sqlite-connection';

const TRANSACTION_WAIT_LIMIT_MS = 5000;

/**
 * Runs work as synchronous better-sqlite3 transactions on TypeORM's connection, so no request can interleave
 * with one. The work must be synchronous. It waits out another request's TypeORM transaction at the connection gate,
 * and any open transaction that skipped the gate, rather than nest inside it. It nests as a savepoint inside its own
 * request's.
 */
@Injectable()
export class SyncDatabaseService {
  constructor(private readonly dataSource: DataSource) {}

  /** Takes the write lock before the first read. */
  async write<T>(work: (db: SqliteDatabase) => T): Promise<T> {
    const db = sqliteConnection(this.dataSource);

    return this.outsideOtherTransactions(db, () => db.transaction(() => work(db)).immediate());
  }

  async read<T>(work: (db: SqliteDatabase) => T): Promise<T> {
    const db = sqliteConnection(this.dataSource);

    return this.outsideOtherTransactions(db, () => db.transaction(() => work(db)).deferred());
  }

  private async outsideOtherTransactions<T>(db: SqliteDatabase, work: () => T): Promise<T> {
    try {
      return await connectionGate.runSync(work, TRANSACTION_WAIT_LIMIT_MS, () => db.inTransaction);
    } catch (error) {
      if (error instanceof ConnectionGateTimeoutError) {
        throw new ServiceUnavailableException('The database stayed busy');
      }

      throw error;
    }
  }
}
