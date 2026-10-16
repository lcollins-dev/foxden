import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { SessionListResponseDto } from '@libs/dto';
import { codeChallengeS256, createCodeVerifier, OLDSYNC_SCOPE } from '@libs/fxa-crypto';

import { deleteSession, listSessions, login, logout, signOutOtherSessions } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { keyIdHeader } from '../../utils/access-token';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const FIREFOX_CLIENT_ID = '5882386c6d801776';

interface ISignedIn {
  user: ITestUser;
  web: string;
  firefox: string;
  refreshToken: string;
  accessTokens: string[];
}

describe('Signing out a session revokes its OAuth tokens (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  const server = () => request(app.getHttpServer());

  const refreshGrant = (refreshToken: string) =>
    server()
      .post('/oauth/v1/token')
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken });

  const offlineCodeGrant = async (sessionToken: string): Promise<request.Response> => {
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

    return server()
      .post('/auth/v1/oauth/token')
      .send({
        client_id: FIREFOX_CLIENT_ID,
        grant_type: 'authorization_code',
        code: authorized.body.code,
        code_verifier: codeVerifier,
      })
      .expect(200);
  };

  /** A Firefox session that kept the refresh token of an offline code grant, beside a web app session. */
  const signedIn = async (user?: ITestUser): Promise<ISignedIn> => {
    const account = user ?? (await createTestUser(app));
    const firefox = await login(app, account.email);
    const web = await login(app, account.email);

    const granted = await offlineCodeGrant(firefox);
    const refreshed = await refreshGrant(granted.body.refresh_token).expect(200);

    const credentials = await server()
      .post('/auth/v1/oauth/token')
      .set(authHeaders(firefox))
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'fxa-credentials', scope: OLDSYNC_SCOPE })
      .expect(200);

    return {
      user: account,
      web,
      firefox,
      refreshToken: granted.body.refresh_token,
      accessTokens: [granted.body.access_token, refreshed.body.access_token, credentials.body.access_token],
    };
  };

  const tokenserverResponse = async (user: ITestUser, accessToken: string): Promise<request.Response> => {
    const [row] = await dbQuery<{ keysChangedAt: number }>(app, 'SELECT "keysChangedAt" FROM "user" WHERE id = ?', [
      user.id,
    ]);

    return server()
      .get('/token/1.0/sync/1.5')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-KeyID', keyIdHeader(row.keysChangedAt, 'aaaa'));
  };

  const introspect = async (token: string): Promise<boolean> =>
    (await server().post('/oauth/v1/introspect').send({ token }).expect(200)).body.active;

  const firefoxSessionId = async (signed: ISignedIn): Promise<number> => {
    const sessions = ((await listSessions(app, signed.firefox).expect(200)).body as SessionListResponseDto).sessionList;
    const [current] = sessions.filter(session => session.current);

    return current.id;
  };

  const expectRevoked = async (signed: ISignedIn): Promise<void> => {
    expect((await refreshGrant(signed.refreshToken).expect(401)).body.errno).toBe(110);
    expect(await introspect(signed.refreshToken)).toBe(false);

    for (const accessToken of signed.accessTokens) {
      expect(await introspect(accessToken)).toBe(false);
      const refused = await tokenserverResponse(signed.user, accessToken);

      expect(refused.status).toBe(401);
      expect(refused.body.status).toBe('invalid-credentials');
    }
  };

  const expectLive = async (signed: ISignedIn): Promise<void> => {
    await refreshGrant(signed.refreshToken).expect(200);

    for (const accessToken of signed.accessTokens) {
      expect(await introspect(accessToken)).toBe(true);
      expect((await tokenserverResponse(signed.user, accessToken)).status).toBe(200);
    }
  };

  it('revokes them when the session is signed out from the web app', async () => {
    const signed = await signedIn();
    const other = await signedIn(signed.user);
    await expectLive(signed);

    await deleteSession(app, signed.web, await firefoxSessionId(signed)).expect(200);

    await expectRevoked(signed);
    await expectLive(other);
  });

  it('revokes them when Firefox destroys its session', async () => {
    const signed = await signedIn();

    await server().post('/auth/v1/session/destroy').set(authHeaders(signed.firefox)).send({}).expect(200);

    await expectRevoked(signed);
  });

  it('revokes them when the web app signs out its own session', async () => {
    const signed = await signedIn();

    await logout(app, signed.firefox).expect(201);

    await expectRevoked(signed);
  });

  it("revokes them when the session's device is destroyed", async () => {
    const signed = await signedIn();
    const device = await server()
      .post('/auth/v1/account/device')
      .set(authHeaders(signed.firefox))
      .send({ name: 'Firefox', type: 'mobile' })
      .expect(200);

    await server()
      .post('/auth/v1/account/device/destroy')
      .set(authHeaders(signed.web))
      .send({ id: device.body.id })
      .expect(200);

    await expectRevoked(signed);
  });

  it("revokes the calling session's own tokens when it signs out the others, as every account-wide sign-out does", async () => {
    const signed = await signedIn();

    await signOutOtherSessions(app, signed.firefox).expect(200);

    await expectRevoked(signed);
  });

  it('replaces the session`s refresh token when it is issued another, leaving its access tokens live', async () => {
    const signed = await signedIn();

    const replacement = (await offlineCodeGrant(signed.firefox)).body.refresh_token;

    expect((await refreshGrant(signed.refreshToken).expect(401)).body.errno).toBe(110);
    await expectLive({ ...signed, refreshToken: replacement });

    const rows = await dbQuery(app, 'SELECT id FROM refresh_token WHERE "sessionId" = ?', [
      await firefoxSessionId(signed),
    ]);
    expect(rows).toHaveLength(1);

    await server()
      .post('/oauth/v1/destroy')
      .send({ client_id: FIREFOX_CLIENT_ID, token: signed.refreshToken })
      .expect(200, {});
    await refreshGrant(replacement).expect(200);
  });

  it('spends no authorization code once its session is signed out', async () => {
    const user = await createTestUser(app);
    const firefox = await login(app, user.email);
    const codeVerifier = createCodeVerifier();

    const authorized = await server()
      .post('/auth/v1/oauth/authorization')
      .set(authHeaders(firefox))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: 'state',
        scope: OLDSYNC_SCOPE,
        code_challenge: await codeChallengeS256(codeVerifier),
        code_challenge_method: 'S256',
      })
      .expect(200);

    await server().post('/auth/v1/session/destroy').set(authHeaders(firefox)).send({}).expect(200);

    const refused = await server()
      .post('/auth/v1/oauth/token')
      .send({
        client_id: FIREFOX_CLIENT_ID,
        grant_type: 'authorization_code',
        code: authorized.body.code,
        code_verifier: codeVerifier,
      })
      .expect(400);
    expect(refused.body.errno).toBe(172);
  });
});
