import { DataSource, EntityManager, QueryResult } from 'typeorm';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { BetterSqlite3QueryRunner } from 'typeorm/driver/better-sqlite3/BetterSqlite3QueryRunner';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

import { connectionGate } from './connection-gate';

type TransactionWork<T> = (entityManager: EntityManager) => Promise<T>;

/**
 * Gates every query, and every transaction begun on the runner itself rather than through the entity manager, such as
 * the one `Repository.save` opens outside `@Transactional()` and the start-up migrations'.
 */
class GatedQueryRunner extends BetterSqlite3QueryRunner {
  private releaseRunnerTransaction: (() => void) | null = null;

  override query(query: string, parameters: unknown[] | undefined, useStructuredResult: true): Promise<QueryResult>;
  override query(query: string, parameters?: unknown[]): Promise<unknown>;
  override query(query: string, parameters?: unknown[], useStructuredResult?: boolean): Promise<unknown> {
    return connectionGate.query(() => super.query(query, parameters, useStructuredResult));
  }

  override async startTransaction(isolationLevel?: IsolationLevel): Promise<void> {
    if (connectionGate.isOwner()) {
      return super.startTransaction(isolationLevel);
    }

    this.releaseRunnerTransaction = await connectionGate.hold();

    try {
      await super.startTransaction(isolationLevel);
    } catch (error) {
      if (this.transactionDepth === 0) {
        this.endRunnerTransaction();
      }

      throw error;
    }
  }

  override async commitTransaction(): Promise<void> {
    await super.commitTransaction();

    if (this.transactionDepth === 0) {
      this.endRunnerTransaction();
    }
  }

  override async rollbackTransaction(): Promise<void> {
    const outermost = this.transactionDepth <= 1;

    try {
      await super.rollbackTransaction();
    } finally {
      if (outermost) {
        this.endRunnerTransaction();
      }
    }
  }

  private endRunnerTransaction(): void {
    const release = this.releaseRunnerTransaction;
    this.releaseRunnerTransaction = null;

    release?.();
  }
}

/** Call before the data source initialises. */
export const gateDataSource = (dataSource: DataSource): DataSource => {
  const driver = dataSource.driver;

  if (!(driver instanceof BetterSqlite3Driver) || driver.queryRunner !== undefined) {
    throw new Error('The connection gate needs an uninitialised better-sqlite3 data source');
  }

  driver.queryRunner = new GatedQueryRunner(driver);

  const manager = dataSource.manager;
  const transaction = manager.transaction.bind(manager);

  function gatedTransaction<T>(work: TransactionWork<T>): Promise<T>;
  function gatedTransaction<T>(isolationLevel: IsolationLevel, work: TransactionWork<T>): Promise<T>;
  function gatedTransaction<T>(isolationOrWork: IsolationLevel | TransactionWork<T>, work?: TransactionWork<T>) {
    return connectionGate.transaction(() => {
      if (typeof isolationOrWork === 'function') {
        return transaction(isolationOrWork);
      }

      if (work === undefined) {
        throw new Error('A transaction with an isolation level needs its work');
      }

      return transaction(isolationOrWork, work);
    });
  }

  manager.transaction = gatedTransaction;

  return dataSource;
};
