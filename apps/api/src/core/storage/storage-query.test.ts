import { describe, expect, it } from 'vitest';

import { buildBsoListQuery, IBsoListOptions } from './storage-query';

const options = (fields: Partial<IBsoListOptions> = {}): IBsoListOptions => ({
  ids: null,
  newer: null,
  older: null,
  full: false,
  limit: null,
  offset: 0,
  sort: 'newest',
  ...fields,
});

describe('storage-query', () => {
  describe('buildBsoListQuery', () => {
    it('lists visible ids newest first, capped at max_total_records', () => {
      expect(buildBsoListQuery(7, 'history', options(), 1700000000000)).toEqual({
        sql:
          'SELECT id FROM storage_bso WHERE uid = ? AND collection = ? AND (expiry IS NULL OR expiry > ?) ' +
          'ORDER BY modified DESC, id DESC LIMIT ? OFFSET ?',
        params: [7, 'history', 1700000000000, 10001, 0],
        pageSize: 10000,
      });
    });

    it('adds each filter with its parameter, in order', () => {
      const query = buildBsoListQuery(
        7,
        'history',
        options({ full: true, newer: 100, older: 200, ids: ['a', 'b'], limit: 2, offset: 4, sort: 'oldest' }),
        50
      );

      expect(query.sql).toBe(
        'SELECT id, modified, payload, sortindex FROM storage_bso WHERE uid = ? AND collection = ? ' +
          'AND (expiry IS NULL OR expiry > ?) AND modified > ? AND modified < ? AND id IN (?, ?) ' +
          'ORDER BY modified ASC, id ASC LIMIT ? OFFSET ?'
      );
      expect(query.params).toEqual([7, 'history', 50, 100, 200, 'a', 'b', 3, 4]);
      expect(query.pageSize).toBe(2);
    });

    it('orders by sortindex for sort=index and never pages beyond max_total_records', () => {
      const query = buildBsoListQuery(1, 'c', options({ sort: 'index', limit: 50000 }), 0);

      expect(query.sql).toContain('ORDER BY sortindex DESC, id DESC');
      expect(query.pageSize).toBe(10000);
    });
  });
});
