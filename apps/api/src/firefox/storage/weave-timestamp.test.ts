import { describe, expect, it } from 'vitest';

import { formatTimestamp, parseTimestamp } from './weave-timestamp';

describe('weave-timestamp', () => {
  it('formats seconds with exactly two decimals', () => {
    expect(formatTimestamp(1700000000100)).toBe('1700000000.10');
    expect(formatTimestamp(1700000000000)).toBe('1700000000.00');
    expect(formatTimestamp(1700000000990)).toBe('1700000000.99');
    expect(formatTimestamp(0)).toBe('0.00');
  });

  it.each([
    ['1700000000.12', 1700000000120],
    ['1700000000', 1700000000000],
    ['1700000000.1', 1700000000100],
    ['0', 0],
    [' 12.5 ', 12500],
    ['.5', 500],
  ])('parses %s', (text, expected) => {
    expect(parseTimestamp(text)).toBe(expected);
  });

  it('round-trips every value it formats', () => {
    for (const ms of [0, 10, 1700000000120, 1790782536170]) {
      expect(parseTimestamp(formatTimestamp(ms))).toBe(ms);
    }
  });

  it.each(['', '-3', 'abc', '1e5', 'NaN', 'Infinity', '1.2.3', '9'.repeat(20)])('rejects %s', text => {
    expect(parseTimestamp(text)).toBeNull();
  });
});
