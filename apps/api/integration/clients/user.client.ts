import { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';

import { authHeaders } from '../utils/auth';
import { dbQuery } from '../utils/db';

/**
 * Opens a session for an existing account straight in the database and returns the `fxs_<tokenId>` credential the
 * web app sends. The onepw sign-in itself is covered by the accounts flow spec.
 */
export const login = async (app: NestExpressApplication, email: string): Promise<string> => {
  const users = await dbQuery<{ id: number }>(app, 'SELECT id FROM "user" WHERE "normalizedEmail" = ?', [
    email.toLowerCase(),
  ]);

  if (users.length === 0) {
    throw new Error(`No account for ${email}`);
  }

  const tokenId = randomBytes(32).toString('hex');
  const tokenIdHash = createHash('sha256').update(Buffer.from(tokenId, 'hex')).digest('hex');
  const now = Date.now();

  await dbQuery(
    app,
    `INSERT INTO "session" ("tokenIdHash", "userId", "userAgent", "createdAt", "lastAccessAt", "authAt")
     VALUES (?, ?, NULL, ?, ?, ?)`,
    [tokenIdHash, users[0].id, now, now, now]
  );

  return `fxs_${tokenId}`;
};

export const getProfile = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/user/profile').set(authHeaders(token));

export const logout = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).post('/api/v1/user/logout').set(authHeaders(token));

export const getUserList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown>,
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/user/list?page=${page}`).set(authHeaders(token)).send(body);

export const getUserStats = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/user/stats').set(authHeaders(token));

export const createInvite = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/invite').set(authHeaders(token)).send(body);

export const getUser = (app: NestExpressApplication, token: string, userId: number | string) =>
  request(app.getHttpServer()).get(`/api/v1/admin/user/${userId}`).set(authHeaders(token));

export const updateUser = (app: NestExpressApplication, token: string, userId: number, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/user/${userId}`).set(authHeaders(token)).send(body);

export const updateUserState = (
  app: NestExpressApplication,
  token: string,
  userId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/user/${userId}/state`).set(authHeaders(token)).send(body);

export const deleteUser = (app: NestExpressApplication, token: string, userId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/user/${userId}`).set(authHeaders(token));

export const listSessions = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/user/session/list').set(authHeaders(token));

export const deleteSession = (app: NestExpressApplication, token: string, sessionId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/user/session/${sessionId}`).set(authHeaders(token));

export const signOutOtherSessions = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).post('/api/v1/user/session/sign-out-others').set(authHeaders(token));

export const createPasswordReset = (app: NestExpressApplication, token: string, userId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/user/${userId}/password-reset`).set(authHeaders(token));
