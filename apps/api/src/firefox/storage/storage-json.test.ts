import { describe, expect, it } from 'vitest';

import { bsoJson, postResultJson, timestampsJson } from './storage-json';

// test_storage.py test_meta_global_sanity asserts this shape on the raw body.
const TWO_DECIMALS = /['"]modified['"]:\s*[0-9]+\.[0-9][0-9]\s*[,}]/;

describe('storage-json', () => {
  it('serialises a BSO in syncstorage-rs key order with a two-decimal modified', () => {
    const json = bsoJson({ id: 'global', modified: 1700000000100, payload: '{"a":1}', sortindex: null });

    expect(json).toBe('{"id":"global","modified":1700000000.10,"payload":"{\\"a\\":1}"}');
    expect(json).toMatch(TWO_DECIMALS);
    expect(bsoJson({ id: 'a', modified: 0, payload: '', sortindex: -5 })).toBe(
      '{"id":"a","modified":0.00,"payload":"","sortindex":-5}'
    );
  });

  it('serialises collection timestamps', () => {
    expect(timestampsJson([])).toBe('{}');
    expect(
      timestampsJson([
        { name: 'bookmarks', modified: 1700000123450 },
        { name: 'meta', modified: 1700000000000 },
      ])
    ).toBe('{"bookmarks":1700000123.45,"meta":1700000000.00}');
  });

  it('serialises POST results with failed as an object even when empty', () => {
    expect(postResultJson({ modified: 1700000000120, success: ['a'], failed: {} })).toBe(
      '{"modified":1700000000.12,"success":["a"],"failed":{}}'
    );
    expect(postResultJson({ batch: 'abc', success: [], failed: { b: 'retry bso' } })).toBe(
      '{"batch":"abc","success":[],"failed":{"b":"retry bso"}}'
    );
  });
});
