import { describe, expect, it } from 'vitest';

import { isFirefoxForAndroid, isFirefoxForIos } from './userAgent';

describe('isFirefoxForAndroid', () => {
  it('matches Firefox for Android only', () => {
    expect(isFirefoxForAndroid('Mozilla/5.0 (Android 15; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0')).toBe(true);
    expect(isFirefoxForAndroid('Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0')).toBe(false);
    expect(
      isFirefoxForAndroid(
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile'
      )
    ).toBe(false);
    expect(
      isFirefoxForAndroid(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/157.0 Mobile/15E148'
      )
    ).toBe(false);
  });

  it('matches Firefox for iOS by its FxiOS token', () => {
    expect(isFirefoxForIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) FxiOS/157.0 Mobile/15E148')).toBe(
      true
    );
    expect(isFirefoxForIos('Mozilla/5.0 (Android 15; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0')).toBe(false);
  });
});
