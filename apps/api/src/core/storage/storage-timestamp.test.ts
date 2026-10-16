import { describe, expect, it } from 'vitest';

import { floorTimestamp, nextWriteTimestamp } from './storage-timestamp';

describe('storage-timestamp', () => {
  it('floors to 10 ms', () => {
    expect(floorTimestamp(1700000000129)).toBe(1700000000120);
    expect(floorTimestamp(1700000000120)).toBe(1700000000120);
  });

  describe('nextWriteTimestamp', () => {
    it('is the current time floored when it is later than every earlier write', () => {
      expect(nextWriteTimestamp(1700000000129, 1700000000000)).toBe(1700000000120);
    });

    it('is 10 ms after the last write when the clock has not moved past it', () => {
      expect(nextWriteTimestamp(1700000000125, 1700000000120)).toBe(1700000000130);
      expect(nextWriteTimestamp(1600000000000, 1700000000120)).toBe(1700000000130);
    });
  });
});
