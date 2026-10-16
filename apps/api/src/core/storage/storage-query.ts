import { STORAGE_LIMITS } from './storage-limits';

export type BsoSort = 'newest' | 'oldest' | 'index';

export interface IBsoListOptions {
  ids: string[] | null;
  newer: number | null;
  older: number | null;
  full: boolean;
  limit: number | null;
  offset: number;
  sort: BsoSort;
}

export interface IBsoListQuery {
  sql: string;
  params: (string | number)[];
  /** The page size; the query fetches one row more to tell whether another page follows. */
  pageSize: number;
}

// Every order ends on `id`, so pages are stable: Firefox pages without `sort` and pins the collection meanwhile.
const ORDER_BY: Record<BsoSort, string> = {
  newest: 'modified DESC, id DESC',
  oldest: 'modified ASC, id ASC',
  index: 'sortindex DESC, id DESC',
};

/**
 * Lists a collection's visible BSOs. The offset is a plain row count into the total order; a page without `limit`
 * stops at `max_total_records` like syncstorage-rs.
 */
export function buildBsoListQuery(
  uid: number,
  collection: string,
  options: IBsoListOptions,
  nowMs: number
): IBsoListQuery {
  const columns = options.full ? 'id, modified, payload, sortindex' : 'id';
  const conditions = ['uid = ?', 'collection = ?', '(expiry IS NULL OR expiry > ?)'];
  const params: (string | number)[] = [uid, collection, nowMs];

  if (options.newer !== null) {
    conditions.push('modified > ?');
    params.push(options.newer);
  }

  if (options.older !== null) {
    conditions.push('modified < ?');
    params.push(options.older);
  }

  if (options.ids !== null) {
    conditions.push(`id IN (${options.ids.map(() => '?').join(', ')})`);
    params.push(...options.ids);
  }

  const pageSize = Math.min(options.limit ?? STORAGE_LIMITS.max_total_records, STORAGE_LIMITS.max_total_records);
  params.push(pageSize + 1, options.offset);

  const sql =
    `SELECT ${columns} FROM storage_bso WHERE ${conditions.join(' AND ')} ` +
    `ORDER BY ${ORDER_BY[options.sort]} LIMIT ? OFFSET ?`;

  return { sql, params, pageSize };
}
