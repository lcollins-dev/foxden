import { describe, expect, it } from 'vitest';

import { PublicBaseUrlService } from './public-base-url.service';
import { ConfigService } from '@/config/config.service';

const fromUrl = (webAppBaseUrl: string): PublicBaseUrlService =>
  new PublicBaseUrlService({ webAppBaseUrl } as ConfigService);

describe('PublicBaseUrlService', () => {
  it('takes the scheme default port and lowercases the host', () => {
    expect(fromUrl('https://Sync.Example.com/')).toMatchObject({
      url: 'https://sync.example.com',
      host: 'sync.example.com',
      port: 443,
      pathPrefix: '',
    });
    expect(fromUrl('http://localhost').port).toBe(80);
  });

  it('keeps an explicit port and a path prefix without its trailing slash', () => {
    expect(fromUrl('http://localhost:8080/sync/')).toMatchObject({
      url: 'http://localhost:8080/sync',
      port: 8080,
      pathPrefix: '/sync',
    });
  });

  it('refuses a scheme other than http or https', () => {
    expect(() => fromUrl('ftp://example.com')).toThrow();
  });
});
