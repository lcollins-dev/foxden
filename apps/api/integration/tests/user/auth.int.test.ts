import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { getProfile, login, logout } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';

const PROFILE_ROUTE = '/api/v1/user/profile';
const SESSION_EXPIRED_MESSAGE = 'Your session is invalid or has expired, please login to continue';

describe('Web app session guard over the real request path (integration)', () => {
  let app: NestExpressApplication;
  let user: ITestUser;

  beforeAll(async () => {
    app = await bootstrapApp();

    user = await createTestUser(app);
  });

  it('rejects a request with no authorization header', async () => {
    const response = await request(app.getHttpServer()).get(PROFILE_ROUTE).expect(401);

    expect(response.body.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('rejects a token that is not a session token', async () => {
    await request(app.getHttpServer()).get(PROFILE_ROUTE).set(authHeaders('not-a-token')).expect(401);
  });

  it('rejects a well-formed session token no session holds', async () => {
    await getProfile(app, `fxs_${randomBytes(32).toString('hex')}`).expect(401);
  });

  it('rejects a keyFetchToken in place of a session token', async () => {
    const token = await login(app, user.email);

    await getProfile(app, token.replace('fxs_', 'fxk_')).expect(401);
  });

  it('allows a guarded route with a session token', async () => {
    const token = await login(app, user.email);

    const response = await getProfile(app, token).expect(200);

    expect(response.body.email).toBe(user.email);
  });

  it('ends only the calling session on logout', async () => {
    const separate = await createTestUser(app);
    const firstToken = await login(app, separate.email);
    const secondToken = await login(app, separate.email);

    await logout(app, firstToken).expect(201);

    await getProfile(app, firstToken).expect(401);
    await getProfile(app, secondToken).expect(200);
  });

  it('rejects the session of a disabled account', async () => {
    const disabled = await createTestUser(app, { enabled: false });
    const token = await login(app, disabled.email);

    await getProfile(app, token).expect(401);
  });
});
