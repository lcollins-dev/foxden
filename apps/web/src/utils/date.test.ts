import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDay, formatDayTime, formatDuration, formatRelativeDate } from './date';

const NOW = new Date(2026, 8, 30, 14, 0);

describe('formatDay', () => {
  it('calls a time earlier the same day today', () => {
    expect(formatDay(new Date(2026, 8, 30, 0, 5), NOW)).toBe('Today');
  });

  it('calls the day before yesterday', () => {
    expect(formatDay(new Date(2026, 8, 29, 23, 59), NOW)).toBe('Yesterday');
  });

  it('writes out anything older as day, short month and year', () => {
    expect(formatDay(new Date(2026, 2, 2, 10, 0), NOW)).toBe('2 Mar 2026');
  });
});

describe('formatDayTime', () => {
  it('writes the date and the 24-hour time', () => {
    expect(formatDayTime(new Date(2026, 9, 5, 9, 12))).toBe('5 Oct 2026, 09:12');
  });
});

describe('formatDuration', () => {
  it('gives a tenth of a second under ten seconds', () => {
    expect(formatDuration(0)).toBe('0.0 s');
    expect(formatDuration(420)).toBe('0.4 s');
    expect(formatDuration(9940)).toBe('9.9 s');
  });

  it('rounds to whole seconds under a minute', () => {
    expect(formatDuration(12400)).toBe('12 s');
  });

  it('gives minutes and seconds under an hour', () => {
    expect(formatDuration(185_000)).toBe('3 min 5 s');
  });

  it('gives hours and minutes beyond that', () => {
    expect(formatDuration(3_845_000)).toBe('1 h 4 min');
  });

  it('rounds up into the next unit rather than past its end', () => {
    expect(formatDuration(9960)).toBe('10 s');
    expect(formatDuration(59_600)).toBe('1 min 0 s');
  });

  it('reads a negative span, from a clock stepped back, as none', () => {
    expect(formatDuration(-500)).toBe('0.0 s');
  });
});

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a recent date in minutes', () => {
    expect(formatRelativeDate(new Date(Date.now() - 25 * MINUTE_MS))).toBe('25 minutes ago');
  });

  it('renders an older date in hours', () => {
    expect(formatRelativeDate(new Date(Date.now() - 2 * HOUR_MS))).toBe('2 hours ago');
  });

  it('renders a much older date in days', () => {
    expect(formatRelativeDate(new Date(Date.now() - 3 * DAY_MS))).toBe('3 days ago');
  });

  it('renders a future date as time remaining', () => {
    expect(formatRelativeDate(new Date(Date.now() + 2 * HOUR_MS))).toBe('in 2 hours');
  });
});
