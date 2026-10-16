import { describe, expect, it } from 'vitest';

import { describeUserAgent } from './describeUserAgent';

describe('describeUserAgent', () => {
  it('reads desktop Firefox and its platform', () => {
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0')).toEqual({
      browser: 'Firefox 157',
      os: 'Linux',
    });

    expect(
      describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0')
    ).toEqual({ browser: 'Firefox 157', os: 'macOS' });
  });

  it('names Firefox for Android', () => {
    expect(describeUserAgent('Mozilla/5.0 (Android 15; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0')).toEqual({
      browser: 'Firefox for Android 157',
      os: 'Android',
    });
  });

  it('tells Chrome from Edge', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

    expect(describeUserAgent(chrome)).toEqual({ browser: 'Chrome 140', os: 'Windows' });
    expect(describeUserAgent(`${chrome} Edg/140.0`)).toEqual({ browser: 'Edge 140', os: 'Windows' });
  });

  it('admits when it cannot tell', () => {
    expect(describeUserAgent(null)).toEqual({ browser: 'Unknown browser', os: null });
    expect(describeUserAgent('curl/8.0')).toEqual({ browser: 'Unknown browser', os: null });
  });
});
