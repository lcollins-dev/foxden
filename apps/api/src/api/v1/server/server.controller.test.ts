import { describe, expect, it } from 'vitest';

import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { ConfigService } from '@/config/config.service';

import { ServerController } from '@/api/v1/server/server.controller';

const buildController = (webAppBaseUrl: string): ServerController =>
  new ServerController({ webAppBaseUrl, inviteExpiry: '7d' } as unknown as ConfigService);

describe('ServerController', () => {
  it('reports the public URL without a trailing slash and the invite lifetime in milliseconds', () => {
    expect(buildController('https://sync.example/').getServerInfo()).toEqual({
      publicUrl: 'https://sync.example',
      inviteLifetimeMs: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('keeps a path prefix the proxy publishes the server under', () => {
    expect(buildController('https://example.com/sync').getServerInfo().publicUrl).toBe('https://example.com/sync');
  });

  it('is reachable without a session', () => {
    expect(Reflect.getMetadata(NO_AUTH_METADATA_KEY, ServerController)).toBe(true);
  });
});
