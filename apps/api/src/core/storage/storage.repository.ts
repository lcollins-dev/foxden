import { Injectable } from '@nestjs/common';

import { SqliteDatabase } from '@/database/sync-database.service';

import { IBsoInput, IStoredBso } from './bso';
import { BATCH_LIFETIME_MS } from './storage-limits';
import { IBsoListQuery } from './storage-query';

interface IModifiedRow {
  modified: number;
}

interface IBsoUpsertParams {
  uid: number;
  collection: string;
  id: string;
  sortindex: number | null;
  payload: string | null;
  ttl: number | null;
  timestamp: number;
}

// A NULL parameter was not provided: an update keeps the stored field, and a TTL-only update keeps `modified`
// (syncstorage-rs `put_bso`, `syncstorage-mysql/src/db/db_impl.rs`).
const UPSERT_BSO_SQL = `
  INSERT INTO storage_bso (uid, collection, id, sortindex, payload, modified, expiry)
  VALUES (@uid, @collection, @id, @sortindex, COALESCE(@payload, ''), @timestamp,
          CASE WHEN @ttl IS NULL THEN NULL ELSE @timestamp + @ttl * 1000 END)
  ON CONFLICT (uid, collection, id) DO UPDATE SET
    sortindex = COALESCE(@sortindex, storage_bso.sortindex),
    payload = COALESCE(@payload, storage_bso.payload),
    expiry = CASE WHEN @ttl IS NULL THEN storage_bso.expiry ELSE @timestamp + @ttl * 1000 END,
    modified = CASE WHEN @payload IS NULL AND @sortindex IS NULL THEN storage_bso.modified ELSE @timestamp END
`;

const APPEND_BATCH_ITEM_SQL = `
  INSERT INTO storage_batch_item (uid, batch_id, id, sortindex, payload, ttl)
  VALUES (@uid, @batchId, @id, @sortindex, @payload, @ttl)
  ON CONFLICT (uid, batch_id, id) DO UPDATE SET
    sortindex = COALESCE(excluded.sortindex, storage_batch_item.sortindex),
    payload = COALESCE(excluded.payload, storage_batch_item.payload),
    ttl = COALESCE(excluded.ttl, storage_batch_item.ttl)
`;

const VISIBLE = '(expiry IS NULL OR expiry > ?)';

/** Synchronous SQL for sync storage; callers run it inside a `SyncDatabaseService` transaction. */
@Injectable()
export class StorageRepository {
  storageModified(db: SqliteDatabase, uid: number): number {
    return (
      db.prepare<[number], IModifiedRow>('SELECT modified FROM storage_user WHERE uid = ?').get(uid)?.modified ?? 0
    );
  }

  collectionModified(db: SqliteDatabase, uid: number, collection: string): number {
    return (
      db
        .prepare<
          [number, string],
          IModifiedRow
        >('SELECT modified FROM storage_collection WHERE uid = ? AND collection = ?')
        .get(uid, collection)?.modified ?? 0
    );
  }

  bso(db: SqliteDatabase, uid: number, collection: string, id: string, now: number): IStoredBso | undefined {
    return db
      .prepare<[number, string, string, number], IStoredBso>(
        `SELECT id, modified, payload, sortindex FROM storage_bso
         WHERE uid = ? AND collection = ? AND id = ? AND ${VISIBLE}`
      )
      .get(uid, collection, id, now);
  }

  /** Moves the storage timestamp, and the collection's too when one is given. */
  touch(db: SqliteDatabase, uid: number, collection: string | null, timestamp: number): void {
    if (collection !== null) {
      db.prepare(
        `INSERT INTO storage_collection (uid, collection, modified) VALUES (?, ?, ?)
         ON CONFLICT (uid, collection) DO UPDATE SET modified = excluded.modified`
      ).run(uid, collection, timestamp);
    }

    db.prepare(
      `INSERT INTO storage_user (uid, modified) VALUES (?, ?)
       ON CONFLICT (uid) DO UPDATE SET modified = excluded.modified`
    ).run(uid, timestamp);
  }

  collectionTimestamps(db: SqliteDatabase, uid: number): { name: string; modified: number }[] {
    return db
      .prepare<
        [number],
        { name: string; modified: number }
      >('SELECT collection AS name, modified FROM storage_collection WHERE uid = ? ORDER BY collection')
      .all(uid);
  }

  collectionCounts(db: SqliteDatabase, uid: number, now: number): { name: string; count: number }[] {
    return db
      .prepare<[number, number], { name: string; count: number }>(
        `SELECT collection AS name, COUNT(*) AS count FROM storage_bso
         WHERE uid = ? AND ${VISIBLE} GROUP BY collection ORDER BY collection`
      )
      .all(uid, now);
  }

  collectionBytes(db: SqliteDatabase, uid: number, now: number): { name: string; bytes: number }[] {
    return db
      .prepare<[number, number], { name: string; bytes: number }>(
        `SELECT collection AS name, SUM(LENGTH(CAST(payload AS BLOB))) AS bytes FROM storage_bso
         WHERE uid = ? AND ${VISIBLE} GROUP BY collection ORDER BY collection`
      )
      .all(uid, now);
  }

  listBsoIds(db: SqliteDatabase, query: IBsoListQuery): string[] {
    return db
      .prepare<(string | number)[], { id: string }>(query.sql)
      .all(...query.params)
      .map(row => row.id);
  }

  listBsos(db: SqliteDatabase, query: IBsoListQuery): IStoredBso[] {
    return db.prepare<(string | number)[], IStoredBso>(query.sql).all(...query.params);
  }

  /** Writes at `timestamp`; an expired row that is not yet purged counts as absent. */
  upsertBso(db: SqliteDatabase, uid: number, collection: string, bso: IBsoInput, timestamp: number, now: number): void {
    db.prepare(
      `DELETE FROM storage_bso
       WHERE uid = ? AND collection = ? AND id = ? AND expiry IS NOT NULL AND expiry <= ?`
    ).run(uid, collection, bso.id, now);

    db.prepare<IBsoUpsertParams>(UPSERT_BSO_SQL).run({
      uid,
      collection,
      id: bso.id,
      sortindex: bso.sortindex,
      payload: bso.payload,
      ttl: bso.ttl,
      timestamp,
    });
  }

  deleteBsos(db: SqliteDatabase, uid: number, collection: string, ids: string[]): void {
    const statement = db.prepare('DELETE FROM storage_bso WHERE uid = ? AND collection = ? AND id = ?');

    for (const id of ids) {
      statement.run(uid, collection, id);
    }
  }

  /** Deletes the collection with its BSOs and batches; `false` when the user had no such collection. */
  deleteCollection(db: SqliteDatabase, uid: number, collection: string): boolean {
    db.prepare('DELETE FROM storage_bso WHERE uid = ? AND collection = ?').run(uid, collection);
    db.prepare('DELETE FROM storage_batch WHERE uid = ? AND collection = ?').run(uid, collection);

    return (
      db.prepare('DELETE FROM storage_collection WHERE uid = ? AND collection = ?').run(uid, collection).changes > 0
    );
  }

  deleteUsers(db: SqliteDatabase, uids: number[]): void {
    for (const table of ['storage_bso', 'storage_batch', 'storage_collection', 'storage_user']) {
      const statement = db.prepare(`DELETE FROM ${table} WHERE uid = ?`);

      for (const uid of uids) {
        statement.run(uid);
      }
    }
  }

  createBatch(db: SqliteDatabase, uid: number, collection: string, batchId: string, now: number): void {
    db.prepare('INSERT INTO storage_batch (uid, id, collection, created_at) VALUES (?, ?, ?, ?)').run(
      uid,
      batchId,
      collection,
      now
    );
  }

  batchIsOpen(db: SqliteDatabase, uid: number, collection: string, batchId: string, now: number): boolean {
    const batch = db
      .prepare<
        [number, string, string],
        { created_at: number }
      >('SELECT created_at FROM storage_batch WHERE uid = ? AND id = ? AND collection = ?')
      .get(uid, batchId, collection);

    return batch !== undefined && batch.created_at + BATCH_LIFETIME_MS > now;
  }

  /** A later upload of an id merges field by field into the earlier one. */
  appendBatchItems(db: SqliteDatabase, uid: number, batchId: string, bsos: IBsoInput[]): void {
    const statement = db.prepare(APPEND_BATCH_ITEM_SQL);

    for (const bso of bsos) {
      statement.run({ uid, batchId, id: bso.id, sortindex: bso.sortindex, payload: bso.payload, ttl: bso.ttl });
    }
  }

  batchTotals(db: SqliteDatabase, uid: number, batchId: string): { records: number; bytes: number } {
    const totals = db
      .prepare<[number, string], { records: number; bytes: number | null }>(
        `SELECT COUNT(*) AS records, SUM(LENGTH(CAST(payload AS BLOB))) AS bytes
         FROM storage_batch_item WHERE uid = ? AND batch_id = ?`
      )
      .get(uid, batchId);

    return { records: totals?.records ?? 0, bytes: totals?.bytes ?? 0 };
  }

  batchItems(db: SqliteDatabase, uid: number, batchId: string): IBsoInput[] {
    return db
      .prepare<
        [number, string],
        IBsoInput
      >('SELECT id, sortindex, payload, ttl FROM storage_batch_item WHERE uid = ? AND batch_id = ? ORDER BY id')
      .all(uid, batchId);
  }

  /** Its items go with it (ON DELETE CASCADE). */
  deleteBatch(db: SqliteDatabase, uid: number, batchId: string): void {
    db.prepare('DELETE FROM storage_batch WHERE uid = ? AND id = ?').run(uid, batchId);
  }

  purgeExpired(db: SqliteDatabase, now: number): { bsos: number; batches: number } {
    const bsos = db.prepare('DELETE FROM storage_bso WHERE expiry IS NOT NULL AND expiry <= ?').run(now).changes;
    const batches = db.prepare('DELETE FROM storage_batch WHERE created_at <= ?').run(now - BATCH_LIFETIME_MS).changes;

    return { bsos, batches };
  }
}
