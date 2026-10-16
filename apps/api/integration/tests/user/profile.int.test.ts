import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { getProfile, login } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const updateProfile = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch('/api/v1/user/profile').set(authHeaders(token)).send(body);

describe('User profile (integration)', () => {
  let app: NestExpressApplication;
  let user: ITestUser;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    user = await createTestUser(app);
    token = await login(app, user.email);
  });

  it('returns the signed in users own profile', async () => {
    const response = await getProfile(app, token).expect(200);

    expect(response.body.email).toBe(user.email);
  });

  it('persists a name change', async () => {
    await updateProfile(app, token, { name: 'Renamed User' }).expect(200);

    const rows = await dbQuery<{ name: string }>(app, 'select name from "user" where id = ?', [user.id]);

    expect(rows[0].name).toBe('Renamed User');
  });

  it('rejects a name below the minimum length', async () => {
    for (const name of ['', 'J']) {
      await updateProfile(app, token, { name }).expect(400);
    }
  });

  it('rejects a name above the maximum length', async () => {
    await updateProfile(app, token, { name: 'x'.repeat(257) }).expect(400);
  });

  it('rejects an address, which only a change proven with the password may set', async () => {
    await updateProfile(app, token, { name: 'Valid Name', email: 'other@foxden.test' }).expect(400);

    const rows = await dbQuery<{ email: string }>(app, 'select email from "user" where id = ?', [user.id]);
    expect(rows[0].email).toBe(user.email);
  });

  it('rejects the removed password field', async () => {
    await updateProfile(app, token, { name: 'Valid Name', password: 'Str0ng!Pass' }).expect(400);
  });

  it('keeps the session through a profile change', async () => {
    await updateProfile(app, token, { name: 'Still Signed In' }).expect(200);

    await getProfile(app, token).expect(200);
  });

  it('includes the account uid', async () => {
    const response = await getProfile(app, token).expect(200);

    expect(response.body.uid).toBe(user.uid);
  });
});
