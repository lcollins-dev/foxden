import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPreconditions, IStorageContext, StorageService } from './storage.service';
import { SqliteDatabase, SyncDatabaseService } from '@/database/sync-database.service';

import { PreconditionFailedError, StorageRefusedError } from './storage-refusal';
import { StorageRepository } from './storage.repository';
import { isCurrentUid } from '@/core/tokenserver/current-uid';

vi.mock('@/core/tokenserver/current-uid', () => ({ isCurrentUid: vi.fn() }));

const NOW = 1700000000125;

const context = (preconditions: Partial<IPreconditions> = {}): IStorageContext => ({
  uid: 7,
  now: NOW,
  preconditions: { ifModifiedSince: null, ifUnmodifiedSince: null, ...preconditions },
});

const refusalOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof PreconditionFailedError) {
      return `${error.precondition} ${error.lastModified}`;
    }

    if (error instanceof StorageRefusedError) {
      return error.refusal.reason;
    }

    throw error;
  }

  return 'ok';
};

describe('StorageService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: StorageService;

  beforeEach(() => {
    vi.mocked(isCurrentUid).mockReset().mockReturnValue(true);

    const db = {} as SqliteDatabase;
    const run = (work: (database: SqliteDatabase) => unknown) => Promise.resolve().then(() => work(db));

    repository = {
      bso: vi.fn().mockReturnValue(undefined),
      storageModified: vi.fn().mockReturnValue(1700000000000),
      collectionModified: vi.fn().mockReturnValue(110),
      upsertBso: vi.fn(),
      touch: vi.fn(),
      batchIsOpen: vi.fn().mockReturnValue(false),
    };

    service = new StorageService(
      { read: run, write: run } as unknown as SyncDatabaseService,
      repository as unknown as StorageRepository
    );
  });

  describe('preconditions', () => {
    it('refuses X-If-Unmodified-Since once the resource changed after it', async () => {
      expect(await refusalOf(service.postBsos(context({ ifUnmodifiedSince: 100 }), 'c', [], { kind: 'none' }))).toBe(
        'if-unmodified-since 110'
      );
      expect(await refusalOf(service.postBsos(context({ ifUnmodifiedSince: 110 }), 'c', [], { kind: 'none' }))).toBe(
        'ok'
      );
    });

    it('lets X-If-Unmodified-Since: 0 through on a resource that does not exist yet', async () => {
      const bso = { id: 'a', sortindex: null, payload: 'x', ttl: null };

      expect(await refusalOf(service.putBso(context({ ifUnmodifiedSince: 0 }), 'c', bso))).toBe('ok');
    });

    it('refuses X-If-Modified-Since while the resource has not changed since it', async () => {
      const listing = service.listCollection(context({ ifModifiedSince: 110 }), 'c', {
        ids: null,
        newer: null,
        older: null,
        full: false,
        limit: null,
        offset: 0,
        sort: 'newest',
      });

      expect(await refusalOf(listing)).toBe('if-modified-since 110');
    });
  });

  it('writes later than every earlier write of the user', async () => {
    const bso = { id: 'a', sortindex: null, payload: 'x', ttl: null };

    expect(await service.putBso(context(), 'c', bso)).toBe(1700000000120);

    repository.storageModified.mockReturnValue(1700000000120);
    expect(await service.putBso(context(), 'c', bso)).toBe(1700000000130);
  });

  it('refuses an append to a batch that is not open', async () => {
    expect(await refusalOf(service.postBsos(context(), 'c', [], { kind: 'append', batchId: 'b', commit: false }))).toBe(
      'batch-closed'
    );
  });

  it('refuses a missing BSO after checking the preconditions', async () => {
    expect(await refusalOf(service.getBso(context(), 'c', 'a'))).toBe('not-found');
    expect(await refusalOf(service.getBso(context({ ifModifiedSince: 0 }), 'c', 'a'))).toBe('if-modified-since 0');
  });

  describe('a uid the tokenserver no longer hands out', () => {
    const bso = { id: 'a', sortindex: null, payload: 'x', ttl: null };

    it.each<[string, (subject: StorageService) => Promise<unknown>]>([
      ['requireCurrentUid', subject => subject.requireCurrentUid(context())],
      ['collectionTimestamps', subject => subject.collectionTimestamps(context())],
      ['collectionCounts', subject => subject.collectionCounts(context())],
      ['collectionBytes', subject => subject.collectionBytes(context())],
      ['deleteStorage', subject => subject.deleteStorage(context())],
      [
        'listCollection',
        subject =>
          subject.listCollection(context(), 'c', {
            ids: null,
            newer: null,
            older: null,
            full: true,
            limit: null,
            offset: 0,
            sort: 'newest',
          }),
      ],
      ['postBsos', subject => subject.postBsos(context(), 'c', [bso], { kind: 'none' })],
      ['deleteCollection', subject => subject.deleteCollection(context(), 'c', null)],
      ['getBso', subject => subject.getBso(context(), 'c', 'a')],
      ['putBso', subject => subject.putBso(context(), 'c', bso)],
      ['deleteBso', subject => subject.deleteBso(context(), 'c', 'a')],
    ])('refuses %s without touching storage', async (_name, call) => {
      vi.mocked(isCurrentUid).mockReturnValue(false);

      expect(await refusalOf(call(service))).toBe('stale-uid');
      expect(isCurrentUid).toHaveBeenCalledWith(expect.anything(), 7);
      expect(repository.storageModified).not.toHaveBeenCalled();
      expect(repository.collectionModified).not.toHaveBeenCalled();
      expect(repository.bso).not.toHaveBeenCalled();
    });

    it('checks the uid in the same transaction as the work', async () => {
      const transaction = (work: (database: SqliteDatabase) => unknown) =>
        Promise.resolve().then(() => work({} as SqliteDatabase));
      const syncDatabase = { read: vi.fn(transaction), write: vi.fn(transaction) };
      const subject = new StorageService(
        syncDatabase as unknown as SyncDatabaseService,
        repository as unknown as StorageRepository
      );

      await subject.putBso(context(), 'c', bso);

      expect(syncDatabase.write).toHaveBeenCalledOnce();
      expect(syncDatabase.read).not.toHaveBeenCalled();
      expect(vi.mocked(isCurrentUid).mock.calls[0][0]).toBe(repository.upsertBso.mock.calls[0][0]);

      repository.collectionTimestamps = vi.fn().mockReturnValue([]);
      await subject.collectionTimestamps(context());

      expect(syncDatabase.read).toHaveBeenCalledOnce();
      expect(vi.mocked(isCurrentUid).mock.calls[1][0]).toBe(repository.storageModified.mock.calls.at(-1)?.[0]);
    });

    it('refuses before checking the preconditions', async () => {
      vi.mocked(isCurrentUid).mockReturnValue(false);

      expect(await refusalOf(service.putBso(context({ ifUnmodifiedSince: 0 }), 'c', bso))).toBe('stale-uid');
    });
  });
});
