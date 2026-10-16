import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { SessionListResponseDto } from '@libs/dto';
import { codeChallengeS256, createCodeVerifier, OLDSYNC_SCOPE } from '@libs/fxa-crypto';

import { getProfile, listSessions, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';
import { PurgeExpiredSessionsJob } from '@/core/session/purge-expired-sessions.job';

const FIREFOX_CLIENT_ID = '5882386c6d801776';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('Sessions without a device expire 1 day after creation (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  const server = () => request(app.getHttpServer());

  const sessionId = async (token: string): Promise<number> => {
    const sessions = ((await listSessions(app, token).expect(200)).body as SessionListResponseDto).sessionList;
    const [current] = sessions.filter(session => session.current);

    return current.id;
  };

  const age = (id: number, ms: number) =>
    dbQuery(app, 'UPDATE "session" SET "createdAt" = "createdAt" - ? WHERE id = ?', [ms, id]);

  const sessionExists = async (id: number): Promise<boolean> =>
    (await dbQuery(app, 'SELECT id FROM "session" WHERE id = ?', [id])).length > 0;

  const tokenRows = async (id: number): Promise<number> => {
    const refreshTokens = await dbQuery(app, 'SELECT id FROM refresh_token WHERE "sessionId" = ?', [id]);
    const accessTokens = await dbQuery(app, 'SELECT jti FROM access_token WHERE "sessionId" = ?', [id]);

    return refreshTokens.length + accessTokens.length;
  };

  const registerDevice = (token: string) =>
    server()
      .post('/auth/v1/account/device')
      .set(authHeaders(token))
      .send({ name: 'Firefox', type: 'desktop' })
      .expect(200);

  /** An offline code grant, which leaves a refresh token and an access token record on the session. */
  const grantRefreshToken = async (sessionToken: string): Promise<string> => {
    const codeVerifier = createCodeVerifier();

    const authorized = await server()
      .post('/auth/v1/oauth/authorization')
      .set(authHeaders(sessionToken))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: 'state',
        scope: OLDSYNC_SCOPE,
        access_type: 'offline',
        code_challenge: await codeChallengeS256(codeVerifier),
        code_challenge_method: 'S256',
      })
      .expect(200);

    const granted = await server()
      .post('/auth/v1/oauth/token')
      .send({
        client_id: FIREFOX_CLIENT_ID,
        grant_type: 'authorization_code',
        code: authorized.body.code,
        code_verifier: codeVerifier,
      })
      .expect(200);

    return granted.body.refresh_token;
  };

  it('refuses the web app an aged session, which sends it back to sign-in', async () => {
    const user = await createTestUser(app);
    const web = await login(app, user.email);
    const id = await sessionId(web);

    await age(id, ONE_DAY_MS);

    await getProfile(app, web).expect(401);
    expect(await sessionExists(id)).toBe(false);
  });

  it('keeps an aged session that registered a device', async () => {
    const user = await createTestUser(app);
    const firefox = await login(app, user.email);
    await registerDevice(firefox);

    await age(await sessionId(firefox), 10 * ONE_DAY_MS);

    await server().get('/auth/v1/session/status').set(authHeaders(firefox)).expect(200);
  });

  it('purges aged sessions without a device and their tokens, leaving the rest on the session list', async () => {
    const user = await createTestUser(app);
    const web = await login(app, user.email);
    const synced = await login(app, user.email);
    const abandoned = await login(app, user.email);
    await registerDevice(synced);

    const syncedId = await sessionId(synced);
    const abandonedId = await sessionId(abandoned);
    await grantRefreshToken(abandoned);

    await age(syncedId, ONE_DAY_MS);
    await age(abandonedId, ONE_DAY_MS);

    await app.get(PurgeExpiredSessionsJob).run();

    const listed = ((await listSessions(app, web).expect(200)).body as SessionListResponseDto).sessionList;

    expect(listed.map(session => session.id)).toEqual([await sessionId(web), syncedId]);
    expect(await sessionExists(abandonedId)).toBe(false);
    expect(await tokenRows(abandonedId)).toBe(0);
  });
});
