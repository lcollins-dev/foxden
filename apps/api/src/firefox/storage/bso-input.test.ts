import { describe, expect, it } from 'vitest';

import { checkBsoFields, parsePostBody, parsePutBody } from './bso-input';
import { StorageError, WeaveErrorCode } from './storage-error';

const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');

const weaveCodeOf = (work: () => unknown): number | null => {
  try {
    work();
  } catch (error) {
    if (error instanceof StorageError) {
      return error.weaveCode;
    }
  }

  return null;
};

describe('bso-input', () => {
  describe('checkBsoFields', () => {
    it('treats null fields as not provided and ignores modified and collection', () => {
      expect(
        checkBsoFields({ id: 'a', payload: null, sortindex: null, ttl: null, modified: 1.5, collection: 'x' }, 'a')
      ).toEqual({ ok: true, bso: { id: 'a', payload: null, sortindex: null, ttl: null } });
    });

    it.each([
      [{ color: 'red' }, 'unknown field color'],
      [{ sortindex: '2' }, 'invalid json'],
      [{ sortindex: 2.6 }, 'invalid json'],
      [{ sortindex: 1000000000 }, 'invalid bso: sortindex out of range'],
      [{ ttl: -1 }, 'invalid bso: ttl out of range'],
      [{ ttl: 4.2 }, 'invalid json'],
      [{ payload: 42 }, 'invalid json'],
      [{ id: 42 }, 'invalid json'],
    ])('reports %o as %s', (fields, reason) => {
      expect(checkBsoFields(fields, 'a')).toEqual({ ok: false, reason });
    });

    it.each(['A\nB', 'A\tB', '', 'x'.repeat(65), 'café'])('rejects the id %j', id => {
      expect(checkBsoFields({ id }, id)).toEqual({ ok: false, reason: 'invalid bso: invalid id' });
    });
  });

  describe('parsePutBody', () => {
    it('reads a text/plain JSON object, taking the id from the URL', () => {
      expect(parsePutBody(body({ payload: 'x', ttl: 10 }), 'text/plain', 'meta', 'global')).toEqual({
        id: 'global',
        payload: 'x',
        sortindex: null,
        ttl: 10,
      });
    });

    it('rejects non-objects, newline bodies, oversized payloads and a zero crypto IV with code 8', () => {
      const zeroIv = JSON.stringify({ IV: 'AAAAAAAAAAAAAAAAAAAAAA==' });

      expect(weaveCodeOf(() => parsePutBody(body([]), 'text/plain', 'c', 'a'))).toBe(WeaveErrorCode.INVALID_BSO);
      expect(weaveCodeOf(() => parsePutBody(body({}), 'application/newlines', 'c', 'a'))).toBe(8);
      expect(weaveCodeOf(() => parsePutBody(body({ payload: 'x'.repeat(2621441) }), undefined, 'c', 'a'))).toBe(8);
      expect(weaveCodeOf(() => parsePutBody(body({ payload: zeroIv }), undefined, 'crypto', 'keys'))).toBe(8);
      expect(parsePutBody(body({ payload: zeroIv }), undefined, 'bookmarks', 'a').payload).toBe(zeroIv);
    });
  });

  describe('parsePostBody', () => {
    it('stores valid items and fails bad ones individually', () => {
      expect(
        parsePostBody(
          body([
            { id: 'a', payload: 'x' },
            { id: 'b', ttl: 'soon' },
          ]),
          'text/plain',
          'c'
        )
      ).toEqual({
        valid: [{ id: 'a', payload: 'x', sortindex: null, ttl: null }],
        failed: { b: 'invalid json' },
      });
    });

    it('reads application/newlines line by line', () => {
      const lines = Buffer.from('{"id":"a"}\r\n{"id":"b"}\n');

      expect(parsePostBody(lines, 'application/newlines; charset=utf-8', 'c').valid.map(bso => bso.id)).toEqual([
        'a',
        'b',
      ]);
      expect(parsePostBody(Buffer.alloc(0), 'application/newlines', 'c').valid).toEqual([]);
    });

    it.each([
      ['a non-array', '{}'],
      ['an item without an id', '[{"payload":"x"}]'],
      ['a non-object item', '["BAD"]'],
      ['a duplicate id', '[{"id":"a"},{"id":"a"}]'],
      ['invalid JSON', '[{'],
    ])('fails the whole request for %s', (_case, text) => {
      expect(weaveCodeOf(() => parsePostBody(Buffer.from(text), 'application/json', 'c'))).toBe(8);
    });

    it('fails items past max_post_bytes with retry bytes (test_batch_size_limits)', () => {
      const items = [
        { id: 'big', payload: 'x'.repeat(2621440 - 2) },
        { id: 'small', payload: 'xyz' },
      ];

      expect(parsePostBody(body(items), 'text/plain', 'c').failed).toEqual({ small: 'retry bytes' });
    });

    it('moves items past max_post_records to failed with retry bso', () => {
      const items = Array.from({ length: 105 }, (_, i) => ({ id: `item${i}` }));
      const result = parsePostBody(body(items), 'text/plain', 'c');

      expect(result.valid).toHaveLength(100);
      expect(Object.keys(result.failed)).toEqual(['item100', 'item101', 'item102', 'item103', 'item104']);
    });
  });
});
