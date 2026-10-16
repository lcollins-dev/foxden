import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, it } from 'vitest';

import { bootstrapApp } from '../../setup';

const MAX_REQUESTS = 3;

// The throttler and the trusted proxies are read once when the app is built, so this file owns its app.
describe('Rate limiting behind no trusted proxy (integration, serial)', () => {
  let app: NestExpressApplication;

  const accountStatus = (clientAddress: string) =>
    request(app.getHttpServer())
      .post('/auth/v1/account/status')
      .set('X-Forwarded-For', clientAddress)
      .send({ email: 'nobody@foxden.test' });

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = String(MAX_REQUESTS);
    process.env.RATE_LIMIT_WINDOW_SECS = '60';
    process.env.TRUST_PROXY = '0';

    app = await bootstrapApp();
  });

  it('counts every X-Forwarded-For value against the peer when no hop is trusted', async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await accountStatus(`203.0.113.${i + 10}`).expect(200);
    }

    await accountStatus('203.0.113.99').expect(429);
  });
});
