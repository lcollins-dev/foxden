import { SqliteDatabase } from '@/database/sync-database.service';

import { RETIRED_GENERATION } from './tokenserver-rules';

/** Replacing or retiring a uid wipes its storage in the same write, so storage serves only a current uid. */
export function isCurrentUid(db: SqliteDatabase, uid: number): boolean {
  const row = db
    .prepare<
      [number, number],
      { uid: number }
    >('SELECT uid FROM tokenserver_user WHERE uid = ? AND replaced_at IS NULL AND generation < ?')
    .get(uid, RETIRED_GENERATION);

  return row !== undefined;
}
