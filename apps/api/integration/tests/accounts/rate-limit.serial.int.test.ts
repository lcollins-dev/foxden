import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';

const MAX_REQUESTS = 3;
const WINDOW_SECS = 60;

// The throttler reads its limits once when the app is built, so this file owns its app.
describe('Rate limiting (integration, serial)', () => {
  let app: NestExpressApplication;

  const accountStatus = (clientAddress: string) =>
    request(app.getHttpServer())
      .post('/auth/v1/account/status')
      .set('X-Forwarded-For', clientAddress)
      .send({ email: 'nobody@foxden.test' });

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = String(MAX_REQUESTS);
    process.env.RATE_LIMIT_WINDOW_SECS = String(WINDOW_SECS);

    app = await bootstrapApp();
  });

  it('refuses a client past the limit with errno 114 until the window in seconds has passed', async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await accountStatus('203.0.113.1').expect(200);
    }

    const response = await accountStatus('203.0.113.1').expect(429);

    expect(response.body).toMatchObject({ code: 429, errno: 114 });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(WINDOW_SECS / 2);
    expect(response.body.retryAfter).toBe(Number(response.headers['retry-after']));
  });

  it('counts every address in an IPv6 /64 as one client', async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await accountStatus(`2001:db8:0:1::${i + 1}`).expect(200);
    }

    await accountStatus('2001:db8:0:1:ffff::1').expect(429);
    await accountStatus('2001:db8:0:2::1').expect(200);
  });

  it('counts each client the trusted proxy names on its own', async () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      await accountStatus('203.0.113.2').expect(200);
    }

    await accountStatus('203.0.113.2').expect(429);
    await accountStatus('203.0.113.3').expect(200);
  });
});
