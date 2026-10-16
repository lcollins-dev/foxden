import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';

import { ClientThrottlerGuard, throttleTracker } from './client-throttler.guard';

describe('throttleTracker', () => {
  it('counts an IPv4 client by its address', () => {
    expect(throttleTracker('203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts an IPv4-mapped IPv6 address as the IPv4 client', () => {
    expect(throttleTracker('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts every address in an IPv6 /64 as one client', () => {
    expect(throttleTracker('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(throttleTracker('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(throttleTracker('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });

  it('passes through anything that is not an address, or a zone ipaddr.js refuses', () => {
    expect(throttleTracker('unknown')).toBe('unknown');
    expect(throttleTracker('2001:db8::1%br-abc')).toBe('2001:db8::1%br-abc');
  });
});

class TrackerProbe extends ClientThrottlerGuard {
  track(ip: string): Promise<string> {
    return this.getTracker({ ip });
  }
}

describe('ClientThrottlerGuard', () => {
  it('tracks a request by its client', async () => {
    const guard = new TrackerProbe([], {} as ThrottlerStorage, new Reflector());

    await expect(guard.track('2001:db8:1:2::1')).resolves.toBe('2001:db8:1:2::/64');
  });
});
