import { describe, expect, it } from 'vitest';
import IconLanguage from '~icons/material-symbols/language-rounded';
import IconLaptopMac from '~icons/material-symbols/laptop-mac-outline-rounded';
import IconSmartphone from '~icons/material-symbols/mobile-outline-rounded';

import type { AccountSessionDto } from '@libs/dto';

import { toSessionRow } from './sessionRow';

const NOW = new Date(2026, 8, 30, 14, 0);
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0';

const session = (overrides: Partial<AccountSessionDto>): AccountSessionDto => ({
  id: 1,
  device: null,
  userAgent: MAC_FIREFOX,
  createdAt: new Date(2026, 2, 2, 9, 0).toISOString(),
  lastAccessAt: new Date(2026, 8, 30, 13, 58).toISOString(),
  current: false,
  ...overrides,
});

describe('toSessionRow', () => {
  it('shows a Firefox by the name it registered, with its client and dates', () => {
    const row = toSessionRow(session({ device: { name: "Sam's MacBook Pro", type: 'desktop' } }), NOW);

    expect(row).toEqual({
      id: 1,
      firefox: true,
      name: "Sam's MacBook Pro",
      icon: IconLaptopMac,
      meta: 'Firefox 157 on macOS · Active now · Signed in 2 Mar 2026',
      current: false,
    });
  });

  it('picks the icon from the device type', () => {
    expect(toSessionRow(session({ device: { name: 'Pixel 9', type: 'mobile' } }), NOW).icon).toBe(IconSmartphone);
  });

  it('names a Firefox that registered no name after its client', () => {
    expect(toSessionRow(session({ device: { name: '', type: 'desktop' } }), NOW).name).toBe('Firefox 157 on macOS');
  });

  it('shows a web sign-in as the browser and platform, without the version', () => {
    const row = toSessionRow(session({ current: true }), NOW);

    expect(row).toMatchObject({
      firefox: false,
      name: 'Firefox on macOS',
      icon: IconLanguage,
      meta: 'Active now · Signed in 2 Mar 2026',
      current: true,
    });
  });

  it('says how long ago a quiet session was used', () => {
    const row = toSessionRow(
      session({ lastAccessAt: new Date(NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString() }),
      NOW
    );

    expect(row.meta).toMatch(/^Active .+ ago · /);
  });
});
