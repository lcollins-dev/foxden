import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// The api's DATABASE_PATH when the environment sets it, otherwise this checkout's dev instance database, as
// resources/instanced/env.sh places it.
const resolveDatabasePath = (): string => {
  if (process.env.DATABASE_PATH !== undefined) {
    return process.env.DATABASE_PATH;
  }

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();

  return join(root, '.workdir', 'data', 'foxden.sqlite');
};

/**
 * Holds an account to first-time setup, as the server does only for the default admin it creates on a fresh
 * database. The suite runs against an instance with the seeded test admin, which never gets one.
 */
export const requirePasswordChange = (email: string): void => {
  const db = new Database(resolveDatabasePath(), { fileMustExist: true, timeout: 5000 });

  try {
    const result = db
      .prepare('UPDATE "user" SET "mustChangePassword" = 1 WHERE "normalizedEmail" = ?')
      .run(email.toLowerCase());

    if (result.changes !== 1) {
      throw new Error(`No account ${email} in ${db.name}`);
    }
  } finally {
    db.close();
  }
};

/** Seeds a finished failed run, since no job fails on demand, dated a day ahead so it lists above any real run. */
export const addFailedBatchJobRun = (batchJobId: number, error: string): number => {
  const db = new Database(resolveDatabasePath(), { fileMustExist: true, timeout: 5000 });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');

  try {
    const result = db
      .prepare(
        'INSERT INTO batch_job_run ("batchJobId", "startDate", "endDate", "result", "error") VALUES (?, ?, ?, ?, ?)'
      )
      .run(batchJobId, tomorrow, tomorrow, 'failed', error);

    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
};

export const deleteBatchJobRun = (batchJobRunId: number): void => {
  const db = new Database(resolveDatabasePath(), { fileMustExist: true, timeout: 5000 });

  try {
    db.prepare('DELETE FROM batch_job_run WHERE "id" = ?').run(batchJobRunId);
  } finally {
    db.close();
  }
};
