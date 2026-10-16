import { describe, expect, it } from 'vitest';

import { StorageError } from './storage-error';
import { parseBsoListOptions, parseIds, queryParams } from './storage-query';
import { IBsoListOptions } from '@/core/storage/storage-query';

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

const parse = (query: string): IBsoListOptions => parseBsoListOptions(queryParams(`/storage/1.5/1/storage/c?${query}`));

describe('storage-query', () => {
  describe('parseBsoListOptions', () => {
    it('reads the paginated download Firefox sends', () => {
      expect(parse('newer=1700000000.12&full=1&sort=oldest&limit=1000&offset=2000')).toEqual(
        options({ newer: 1700000000120, full: true, sort: 'oldest', limit: 1000, offset: 2000 })
      );
    });

    it('treats full as present whatever its value and ignores unknown parameters', () => {
      expect(parse('full=&v=1.161.0').full).toBe(true);
      expect(parse('&limit=2')).toEqual(options({ limit: 2 }));
      expect(queryParams('/storage/1.5/1/storage/c').toString()).toBe('');
    });

    it.each(['newer=abc', 'older=-1', 'limit=-1', 'limit=1.5', 'offset=abc', 'sort=index2', 'limit=4294967296'])(
      'rejects %s',
      query => {
        expect(() => parse(query)).toThrow(StorageError);
      }
    );
  });

  describe('parseIds', () => {
    it('splits on commas, trims and drops empty entries', () => {
      expect(parseIds(' a, b,,c ,')).toEqual(['a', 'b', 'c']);
    });

    it('rejects more than 100 ids or an invalid id', () => {
      expect(() => parseIds(Array.from({ length: 101 }, (_, i) => `id${i}`).join(','))).toThrow(StorageError);
      expect(parseIds(Array.from({ length: 100 }, (_, i) => `id${i}`).join(','))).toHaveLength(100);
      expect(() => parseIds('x'.repeat(65))).toThrow(StorageError);
      expect(() => parseIds('aé')).toThrow(StorageError);
    });
  });
});
