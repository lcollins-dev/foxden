import { describe, expect, it } from 'vitest';

import { hashToken, safeEqual } from '@/common/secret-token';

const TOKEN_ID = 'c0a29dcf46174973da1378696e4c82ae10f723cf4f4d9f75e39f4ae3851595ab';

describe('hashToken', () => {
  it('hashes the token bytes, not its hex text', () => {
    expect(hashToken(TOKEN_ID)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(TOKEN_ID)).not.toBe(TOKEN_ID);
    expect(hashToken(TOKEN_ID)).toBe(hashToken(TOKEN_ID));
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
