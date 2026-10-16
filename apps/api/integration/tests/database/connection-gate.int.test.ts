import { NestExpressApplication } from '@nestjs/platform-express';
import { setImmediate as nextMacrotask, setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { BetterSqlite3Driver } from 'typeorm/driver/better-sqlite3/BetterSqlite3Driver';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';

import { SyncDatabaseService } from '@/database/sync-database.service';

import { login, updateUser } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

// Long enough for a request to finish when nothing holds it back, as it would inside another's transaction.
const REQUEST_WINDOW_MS = 200;

// Enough microtask offsets to start a transaction at every step of a repository save.
const SAVE_STEPS = 60;

describe('Connection gate (integration)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let users: Repository<User>;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    dataSource = app.get(DataSource);
    users = dataSource.getRepository(User);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  const storedName = async (user: ITestUser): Promise<string> => {
    const rows = await dbQuery<{ name: string }>(app, 'SELECT "name" FROM "user" WHERE "id" = ?', [user.id]);

    return rows[0].name;
  };

  const rename = async (user: ITestUser, name: string): Promise<void> => {
    await dataSource.query('UPDATE "user" SET "name" = ? WHERE "id" = ?', [name, user.id]);
  };

  const connectionInTransaction = (): boolean => {
    const driver = dataSource.driver;

    if (!(driver instanceof BetterSqlite3Driver)) {
      throw new Error('Expected the better-sqlite3 driver');
    }

    return driver.databaseConnection.inTransaction;
  };

  const isPending = async (promise: Promise<unknown>, windowMs: number): Promise<boolean> => {
    const settled = await Promise.race([promise.then(() => true), sleep(windowMs, false)]);

    return !settled;
  };

  const microtasks = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) {
      await Promise.resolve();
    }
  };

  /**
   * Sends the request while a transaction that renamed `refused` is open, then rolls that back. Sends from outside the
   * transaction: supertest starts the server listening on first use, and every request would inherit that context.
   */
  const overlapWithRollback = async (refused: ITestUser, send: () => Promise<request.Response>): Promise<number> => {
    const written = Promise.withResolvers<undefined>();
    const rollBack = Promise.withResolvers<undefined>();

    const failing = runInTransaction(async () => {
      await rename(refused, 'Refused');

      written.resolve(undefined);
      await rollBack.promise;

      throw new Error('Rolled back');
    });

    await written.promise;

    const response = send();
    expect(await isPending(response, REQUEST_WINDOW_MS)).toBe(true);

    rollBack.resolve(undefined);
    await expect(failing).rejects.toThrow('Rolled back');
    expect(await storedName(refused)).toBe(refused.name);

    return (await response).status;
  };

  it("keeps a transaction's acknowledged write when another request's transaction rolls back", async () => {
    const user = await createTestUser(app);
    const refused = await createTestUser(app);

    const status = await overlapWithRollback(refused, async () =>
      updateUser(app, token, user.id, { name: 'Renamed', email: user.email, userRoleIds: [UserRoleId.SYSTEM_ADMIN] })
    );

    expect(status).toBe(200);
    expect(await storedName(user)).toBe('Renamed');

    const roles = await dbQuery(app, 'SELECT 1 FROM "user_user_role" WHERE "userId" = ? AND "userRoleId" = ?', [
      user.id,
      UserRoleId.SYSTEM_ADMIN,
    ]);

    expect(roles).toHaveLength(1);
  });

  it("keeps a write made outside any transaction while another request's transaction rolls back", async () => {
    const user = await createTestUser(app);
    const refused = await createTestUser(app);
    const userToken = await login(app, user.email);

    const status = await overlapWithRollback(refused, async () =>
      request(app.getHttpServer()).patch('/api/v1/user/profile').set(authHeaders(userToken)).send({ name: 'Renamed' })
    );

    expect(status).toBe(200);
    expect(await storedName(user)).toBe('Renamed');
  });

  describe('a repository save, which begins its own transaction on the query runner', () => {
    it("keeps another transaction's write when the save fails and rolls back", async () => {
      for (let steps = 0; steps < SAVE_STEPS; steps++) {
        const saved = await createTestUser(app);
        const taken = await createTestUser(app);
        const committed = await createTestUser(app);

        const entity = await users.findOneByOrFail({ id: saved.id });
        entity.uid = taken.uid;

        const save = users.save(entity);
        await microtasks(steps);
        const transaction = runInTransaction(async () => rename(committed, 'Committed'));

        const [saveResult, transactionResult] = await Promise.allSettled([save, transaction]);

        expect(saveResult).toMatchObject({ status: 'rejected', reason: { message: /UNIQUE constraint failed/ } });
        expect(transactionResult.status).toBe('fulfilled');
        expect(await storedName(committed)).toBe('Committed');
        expect(connectionInTransaction()).toBe(false);
      }
    });

    it('keeps its write when another transaction rolls back', async () => {
      for (let steps = 0; steps < SAVE_STEPS; steps++) {
        const saved = await createTestUser(app);
        const refused = await createTestUser(app);

        const entity = await users.findOneByOrFail({ id: saved.id });
        entity.name = 'Saved';

        const save = users.save(entity);
        await microtasks(steps);

        const transaction = runInTransaction(async () => {
          await rename(refused, 'Refused');

          throw new Error('Rolled back');
        });

        const [saveResult, transactionResult] = await Promise.allSettled([save, transaction]);

        expect(saveResult.status).toBe('fulfilled');
        expect(transactionResult).toMatchObject({ status: 'rejected', reason: { message: 'Rolled back' } });
        expect(await storedName(saved)).toBe('Saved');
        expect(await storedName(refused)).toBe(refused.name);
        expect(connectionInTransaction()).toBe(false);
      }
    });
  });

  it('holds a sync storage write back until a transaction begun on the query runner rolls back', async () => {
    const user = await createTestUser(app);
    const refused = await createTestUser(app);
    const written = Promise.withResolvers<undefined>();
    const rollBack = Promise.withResolvers<undefined>();
    const queryRunner = dataSource.createQueryRunner();

    const failing = (async () => {
      // Begin after an await, as a repository save does: the gate makes the caller's sync context the owner too.
      await nextMacrotask();
      await queryRunner.startTransaction();

      try {
        await queryRunner.query('UPDATE "user" SET "name" = ? WHERE "id" = ?', ['Refused', refused.id]);

        written.resolve(undefined);
        await rollBack.promise;
      } finally {
        await queryRunner.rollbackTransaction();
      }
    })();

    await written.promise;

    const syncWrite = app
      .get(SyncDatabaseService)
      .write(db => db.prepare('UPDATE "user" SET "name" = ? WHERE "id" = ?').run('Synced', user.id));

    expect(await isPending(syncWrite, REQUEST_WINDOW_MS)).toBe(true);

    rollBack.resolve(undefined);
    await failing;
    await syncWrite;

    expect(await storedName(user)).toBe('Synced');
    expect(await storedName(refused)).toBe(refused.name);
    expect(connectionInTransaction()).toBe(false);
  });
});
