import { Injectable } from '@nestjs/common';

import { SqliteDatabase } from '@/database/sync-database.service';

import { ICurrentUser, IRequestKeys, IUserKeys, RETIRED_GENERATION } from './tokenserver-rules';
import { StorageRepository } from '@/core/storage/storage.repository';

interface IUserRow {
  uid: number;
  generation: number;
  client_state: string;
  keys_changed_at: number | null;
  created_at: number;
  replaced_at: number | null;
}

// syncstorage-rs reads at most this many of a user's rows (`tokenserver-mysql/src/db/db_impl.rs`).
const USER_ROWS_LIMIT = 20;

/**
 * The tokenserver's users: one row per client state an account has used, each with its own storage uid. After a re-key
 * the first token request also allocates a spare row for the replaced current one; uids are never reused, so it costs
 * nothing. Callers run it inside a `SyncDatabaseService` write transaction.
 */
@Injectable()
export class TokenserverUserRepository {
  constructor(private readonly storageRepository: StorageRepository) {}

  /**
   * The account's current row, allocating one for a new account (syncstorage-rs `get_or_create_user`,
   * `tokenserver-db-common/src/lib.rs`). The current row has the highest generation, then the latest creation.
   */
  getOrCreate(db: SqliteDatabase, fxaUid: string, request: IRequestKeys, now: number): ICurrentUser {
    const rows = db
      .prepare<[string, number], IUserRow>(
        `SELECT uid, generation, client_state, keys_changed_at, created_at, replaced_at FROM tokenserver_user
         WHERE fxa_uid = ? ORDER BY created_at DESC, uid DESC LIMIT ?`
      )
      .all(fxaUid, USER_ROWS_LIMIT)
      .sort((left, right) =>
        right.generation !== left.generation ? right.generation - left.generation : right.created_at - left.created_at
      );

    if (rows.length === 0) {
      const keys = { generation: request.generation ?? 0, keysChangedAt: request.keysChangedAt };
      const uid = this.allocate(db, fxaUid, keys, request.clientState, now);

      return { uid, ...keys, clientState: request.clientState, oldClientStates: [] };
    }

    const [current, ...older] = rows;
    const oldClientStates = [
      ...new Set(older.map(row => row.client_state).filter(clientState => clientState !== current.client_state)),
    ];

    const markReplaced = db.prepare('UPDATE tokenserver_user SET replaced_at = ? WHERE uid = ?');

    for (const row of older.filter(olderRow => olderRow.replaced_at === null)) {
      markReplaced.run(current.created_at, row.uid);
    }

    const keys = { generation: current.generation, keysChangedAt: current.keys_changed_at };
    const uid = current.replaced_at === null ? current.uid : this.allocate(db, fxaUid, keys, current.client_state, now);

    return { uid, ...keys, clientState: current.client_state, oldClientStates };
  }

  /**
   * Saves a validated request's keys and returns the uid its token is for. A new client state gets a new uid, because
   * data under the old one is encrypted with keys the account no longer has.
   */
  update(
    db: SqliteDatabase,
    fxaUid: string,
    user: ICurrentUser,
    clientState: string,
    keys: IUserKeys,
    now: number
  ): number {
    if (clientState !== user.clientState) {
      return this.allocate(db, fxaUid, keys, clientState, now);
    }

    if (keys.generation !== user.generation || keys.keysChangedAt !== user.keysChangedAt) {
      db.prepare('UPDATE tokenserver_user SET generation = ?, keys_changed_at = ? WHERE uid = ?').run(
        keys.generation,
        keys.keysChangedAt,
        user.uid
      );
    }

    return user.uid;
  }

  /**
   * Raises the current row's generation without going backwards (syncstorage-rs `update_user_generation`,
   * `tokenserver-mysql/src/db/db_impl.rs`). The current row is the one `getOrCreate` reads, so after a re-key replaced
   * every row the raise still reaches the row the next token request is checked against. An account with no row yet
   * has nothing to update.
   */
  raiseGeneration(db: SqliteDatabase, fxaUid: string, generation: number): void {
    db.prepare(
      `UPDATE tokenserver_user SET generation = ? WHERE generation <= ? AND uid = (
         SELECT uid FROM tokenserver_user WHERE fxa_uid = ? ORDER BY generation DESC, created_at DESC, uid DESC LIMIT 1
       )`
    ).run(generation, generation, fxaUid);
  }

  /**
   * Raises the generation of every row, replaced ones included, then marks them replaced and wipes their storage, so
   * storage refuses every uid the account had and the next token request allocates a fresh one. An account with no row
   * yet has nothing to replace.
   */
  replaceAll(db: SqliteDatabase, fxaUid: string, generation: number, now: number): void {
    db.prepare('UPDATE tokenserver_user SET generation = ? WHERE fxa_uid = ? AND generation < ?').run(
      generation,
      fxaUid,
      generation
    );

    const uids = db
      .prepare<[string], { uid: number }>('SELECT uid FROM tokenserver_user WHERE fxa_uid = ?')
      .all(fxaUid)
      .map(row => row.uid);

    this.storageRepository.deleteUsers(db, uids);

    db.prepare('UPDATE tokenserver_user SET replaced_at = ? WHERE fxa_uid = ? AND replaced_at IS NULL').run(
      now,
      fxaUid
    );
  }

  /**
   * Wipes the storage of every uid the account used and keeps its rows as tombstones at `RETIRED_GENERATION`, which
   * `validateRequestKeys` refuses. An account with no row yet gets one, so a token minted before the deletion cannot
   * allocate storage either.
   */
  retire(db: SqliteDatabase, fxaUid: string, now: number): void {
    const uids = db
      .prepare<[string], { uid: number }>('SELECT uid FROM tokenserver_user WHERE fxa_uid = ?')
      .all(fxaUid)
      .map(row => row.uid);

    this.storageRepository.deleteUsers(db, uids);

    if (uids.length === 0) {
      db.prepare(
        `INSERT INTO tokenserver_user (fxa_uid, generation, client_state, keys_changed_at, created_at)
         VALUES (?, ?, '', NULL, ?)`
      ).run(fxaUid, RETIRED_GENERATION, now);
    } else {
      db.prepare('UPDATE tokenserver_user SET generation = ? WHERE fxa_uid = ?').run(RETIRED_GENERATION, fxaUid);
    }
  }

  /**
   * Inserts a row with a fresh uid, marks the account's other rows replaced and wipes their storage at once. Storage
   * under the new uid is wiped too, in case storage ever outlived the tokenserver's rows.
   */
  private allocate(db: SqliteDatabase, fxaUid: string, keys: IUserKeys, clientState: string, now: number): number {
    const inserted = db
      .prepare(
        `INSERT INTO tokenserver_user (fxa_uid, generation, client_state, keys_changed_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(fxaUid, keys.generation, clientState, keys.keysChangedAt, now);
    const uid = Number(inserted.lastInsertRowid);

    db.prepare(
      'UPDATE tokenserver_user SET replaced_at = ? WHERE fxa_uid = ? AND replaced_at IS NULL AND uid <> ?'
    ).run(now, fxaUid, uid);

    const otherUids = db
      .prepare<[string, number], { uid: number }>('SELECT uid FROM tokenserver_user WHERE fxa_uid = ? AND uid <> ?')
      .all(fxaUid, uid)
      .map(row => row.uid);

    this.storageRepository.deleteUsers(db, [...otherUids, uid]);

    return uid;
  }
}
