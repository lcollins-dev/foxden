import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';

const PUBLIC_URL = 'http://localhost:8080';

describe('Discovery documents (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  it('serves the autoconfig document Firefox reads, with no trailing /v1 on the bases', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/fxa-client-configuration')
      .set('Accept', 'application/json')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    expect(response.body).toEqual({
      auth_server_base_url: `${PUBLIC_URL}/auth`,
      oauth_server_base_url: `${PUBLIC_URL}/oauth`,
      profile_server_base_url: `${PUBLIC_URL}/profile`,
      sync_tokenserver_base_url: `${PUBLIC_URL}/token`,
    });
  });

  it('points OpenID discovery at the JWKS and token endpoints', async () => {
    const response = await request(app.getHttpServer()).get('/.well-known/openid-configuration').expect(200);

    expect(response.body).toMatchObject({
      issuer: PUBLIC_URL,
      jwks_uri: `${PUBLIC_URL}/oauth/v1/jwks`,
      token_endpoint: `${PUBLIC_URL}/oauth/v1/token`,
      userinfo_endpoint: `${PUBLIC_URL}/profile/v1/profile`,
    });
  });

  it('answers accounts errors in Mozilla format', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/v1/account/login')
      .send({ email: 'not-an-email', authPW: 'zz' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 400, errno: 107, error: 'Bad Request' });
  });

  it('answers a missing session token with errno 110', async () => {
    const response = await request(app.getHttpServer()).get('/auth/v1/account/devices').expect(401);

    expect(response.body).toMatchObject({ code: 401, errno: 110 });
  });
});
