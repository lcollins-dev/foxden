import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { SqliteDatabase, SyncDatabaseService } from '@/database/sync-database.service';

import { IBsoInput, IStoredBso } from './bso';
import { STORAGE_LIMITS } from './storage-limits';
import { buildBsoListQuery, IBsoListOptions } from './storage-query';
import { PreconditionFailedError, StorageRefusedError } from './storage-refusal';
import { nextWriteTimestamp } from './storage-timestamp';
import { StorageRepository } from './storage.repository';
import { isCurrentUid } from '@/core/tokenserver/current-uid';

const BATCH_ID_BYTES = 12;

/** Milliseconds; a `null` side was not asked for. */
export interface IPreconditions {
  ifModifiedSince: number | null;
  ifUnmodifiedSince: number | null;
}

export interface IStorageContext {
  uid: number;
  /** Milliseconds at the start of the request. */
  now: number;
  preconditions: IPreconditions;
}

export type BatchMode =
  | { kind: 'none' }
  | { kind: 'create'; commit: boolean }
  | { kind: 'append'; batchId: string; commit: boolean };

/** A read of the user's storage, with the storage timestamp it was read at. */
export interface IStorageRead<T> {
  storageModified: number;
  value: T;
}

export interface ICollectionTimestamp {
  name: string;
  modified: number;
}

export type BsoPage = { full: true; bsos: IStoredBso[] } | { full: false; ids: string[] };

export interface ICollectionListing {
  collectionModified: number;
  page: BsoPage;
  /** The offset of the next page, `null` on the last. */
  nextOffset: number | null;
}

export type PostOutcome =
  | { kind: 'written'; modified: number }
  | { kind: 'batched'; batchId: string; collectionModified: number };

export interface ICollectionDeletion {
  modified: number;
  /** `false` when there was no such collection, so nothing was written and `modified` is the storage timestamp. */
  written: boolean;
}

/**
 * Sync storage 1.5, following syncstorage-rs (`syncserver/src/web/handlers.rs`, `syncstorage-mysql/src/db`). Every
 * method checks the preconditions against the resource's timestamp inside its transaction, before acting, and throws
 * `PreconditionFailedError` when one does not hold. A write takes one timestamp, later than every earlier write of the
 * user, and stamps everything it touches with it.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly syncDatabase: SyncDatabaseService,
    private readonly repository: StorageRepository
  ) {}

  collectionTimestamps(context: IStorageContext): Promise<IStorageRead<ICollectionTimestamp[]>> {
    return this.readStorage(context, db => this.repository.collectionTimestamps(db, context.uid));
  }

  collectionCounts(context: IStorageContext): Promise<IStorageRead<{ name: string; count: number }[]>> {
    return this.readStorage(context, db => this.repository.collectionCounts(db, context.uid, context.now));
  }

  collectionBytes(context: IStorageContext): Promise<IStorageRead<{ name: string; bytes: number }[]>> {
    return this.readStorage(context, db => this.repository.collectionBytes(db, context.uid, context.now));
  }

  /** Returns the write timestamp. */
  deleteStorage(context: IStorageContext): Promise<number> {
    return this.write(context, db => {
      this.checkPreconditions(context, this.repository.storageModified(db, context.uid));

      const timestamp = this.writeTimestamp(db, context);

      this.repository.deleteUsers(db, [context.uid]);
      this.repository.touch(db, context.uid, null, timestamp);

      return timestamp;
    });
  }

  /** `collectionModified` is identical on every page, so Firefox can pin it while paging. */
  listCollection(context: IStorageContext, collection: string, options: IBsoListOptions): Promise<ICollectionListing> {
    return this.read(context, db => {
      const collectionModified = this.repository.collectionModified(db, context.uid, collection);

      this.checkPreconditions(context, collectionModified);

      const query = buildBsoListQuery(context.uid, collection, options, context.now);
      const pageOf = <T>(rows: T[]) => ({
        rows: rows.slice(0, query.pageSize),
        nextOffset: rows.length > query.pageSize ? options.offset + query.pageSize : null,
      });

      if (options.full) {
        const { rows, nextOffset } = pageOf(this.repository.listBsos(db, query));

        return { collectionModified, page: { full: true, bsos: rows }, nextOffset };
      }

      const { rows, nextOffset } = pageOf(this.repository.listBsoIds(db, query));

      return { collectionModified, page: { full: false, ids: rows }, nextOffset };
    });
  }

  postBsos(context: IStorageContext, collection: string, bsos: IBsoInput[], batch: BatchMode): Promise<PostOutcome> {
    return this.write(context, db => {
      const collectionModified = this.repository.collectionModified(db, context.uid, collection);

      this.checkPreconditions(context, collectionModified);

      if (batch.kind === 'none' || (batch.kind === 'create' && batch.commit)) {
        return { kind: 'written', modified: this.writeBsos(db, context, collection, bsos) };
      }

      const batchId = batch.kind === 'create' ? this.createBatch(db, context, collection) : batch.batchId;

      if (batch.kind === 'append' && !this.repository.batchIsOpen(db, context.uid, collection, batchId, context.now)) {
        throw new StorageRefusedError({ reason: 'batch-closed' });
      }

      this.appendToBatch(db, context.uid, batchId, bsos);

      if (!batch.commit) {
        return { kind: 'batched', batchId, collectionModified };
      }

      const batchItems = this.repository.batchItems(db, context.uid, batchId);
      const timestamp = this.writeBsos(db, context, collection, batchItems);

      this.repository.deleteBatch(db, context.uid, batchId);

      return { kind: 'written', modified: timestamp };
    });
  }

  /** Without ids the collection goes entirely; with ids only those BSOs go, and the collection stays listed. */
  deleteCollection(context: IStorageContext, collection: string, ids: string[] | null): Promise<ICollectionDeletion> {
    return this.write(context, db => {
      this.checkPreconditions(context, this.repository.collectionModified(db, context.uid, collection));

      if (ids === null && !this.repository.deleteCollection(db, context.uid, collection)) {
        return { modified: this.repository.storageModified(db, context.uid), written: false };
      }

      const timestamp = this.writeTimestamp(db, context);

      if (ids !== null) {
        this.repository.deleteBsos(db, context.uid, collection, ids);
      }

      this.repository.touch(db, context.uid, ids === null ? null : collection, timestamp);

      return { modified: timestamp, written: true };
    });
  }

  getBso(context: IStorageContext, collection: string, id: string): Promise<IStoredBso> {
    return this.read(context, db => {
      const bso = this.repository.bso(db, context.uid, collection, id, context.now);

      this.checkPreconditions(context, bso?.modified ?? 0);

      if (bso === undefined) {
        throw new StorageRefusedError({ reason: 'not-found' });
      }

      return bso;
    });
  }

  /** Returns the write timestamp, which Firefox keeps as the record's `modified`. */
  putBso(context: IStorageContext, collection: string, bso: IBsoInput): Promise<number> {
    return this.write(context, db => {
      const existing = this.repository.bso(db, context.uid, collection, bso.id, context.now);

      this.checkPreconditions(context, existing?.modified ?? 0);

      return this.writeBsos(db, context, collection, [bso]);
    });
  }

  /** Returns the write timestamp. */
  deleteBso(context: IStorageContext, collection: string, id: string): Promise<number> {
    return this.write(context, db => {
      const existing = this.repository.bso(db, context.uid, collection, id, context.now);

      this.checkPreconditions(context, existing?.modified ?? 0);

      if (existing === undefined) {
        throw new StorageRefusedError({ reason: 'not-found' });
      }

      const timestamp = this.writeTimestamp(db, context);

      this.repository.deleteBsos(db, context.uid, collection, [id]);
      this.repository.touch(db, context.uid, collection, timestamp);

      return timestamp;
    });
  }

  requireCurrentUid(context: IStorageContext): Promise<void> {
    return this.read(context, () => undefined);
  }

  /** Checks the uid in the work's own transaction, so it is atomic with the tokenserver wiping the uid. */
  private write<T>(context: IStorageContext, work: (db: SqliteDatabase) => T): Promise<T> {
    return this.syncDatabase.write(db => {
      this.checkUid(db, context.uid);

      return work(db);
    });
  }

  private read<T>(context: IStorageContext, work: (db: SqliteDatabase) => T): Promise<T> {
    return this.syncDatabase.read(db => {
      this.checkUid(db, context.uid);

      return work(db);
    });
  }

  private checkUid(db: SqliteDatabase, uid: number): void {
    if (!isCurrentUid(db, uid)) {
      throw new StorageRefusedError({ reason: 'stale-uid' });
    }
  }

  private readStorage<T>(context: IStorageContext, read: (db: SqliteDatabase) => T): Promise<IStorageRead<T>> {
    return this.read(context, db => {
      const storageModified = this.repository.storageModified(db, context.uid);

      this.checkPreconditions(context, storageModified);

      return { storageModified, value: read(db) };
    });
  }

  /** A missing resource has timestamp 0, so `X-If-Unmodified-Since: 0` passes on a first upload. */
  private checkPreconditions(context: IStorageContext, resourceModified: number): void {
    const { ifModifiedSince, ifUnmodifiedSince } = context.preconditions;

    if (ifModifiedSince !== null && resourceModified <= ifModifiedSince) {
      throw new PreconditionFailedError('if-modified-since', resourceModified);
    }

    if (ifUnmodifiedSince !== null && resourceModified > ifUnmodifiedSince) {
      throw new PreconditionFailedError('if-unmodified-since', resourceModified);
    }
  }

  private writeTimestamp(db: SqliteDatabase, context: IStorageContext): number {
    return nextWriteTimestamp(context.now, this.repository.storageModified(db, context.uid));
  }

  /** Upserts the BSOs at one new timestamp and moves the collection and storage timestamps to it. */
  private writeBsos(db: SqliteDatabase, context: IStorageContext, collection: string, bsos: IBsoInput[]): number {
    const timestamp = this.writeTimestamp(db, context);

    for (const bso of bsos) {
      this.repository.upsertBso(db, context.uid, collection, bso, timestamp, context.now);
    }

    this.repository.touch(db, context.uid, collection, timestamp);

    return timestamp;
  }

  private createBatch(db: SqliteDatabase, context: IStorageContext, collection: string): string {
    const batchId = randomBytes(BATCH_ID_BYTES).toString('base64url');

    this.repository.createBatch(db, context.uid, collection, batchId, context.now);

    return batchId;
  }

  /** Rolls the append back when the batch outgrows the totals `STORAGE_LIMITS` advertises. */
  private appendToBatch(db: SqliteDatabase, uid: number, batchId: string, bsos: IBsoInput[]): void {
    this.repository.appendBatchItems(db, uid, batchId, bsos);

    const totals = this.repository.batchTotals(db, uid, batchId);

    if (totals.records > STORAGE_LIMITS.max_total_records || totals.bytes > STORAGE_LIMITS.max_total_bytes) {
      throw new StorageRefusedError({ reason: 'batch-too-large' });
    }
  }
}
