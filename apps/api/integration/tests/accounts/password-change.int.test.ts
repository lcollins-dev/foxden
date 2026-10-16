import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  bytesToHex,
  codeChallengeS256,
  createCodeVerifier,
  deriveTokenKeys,
  keyFetchTokenBearer,
  OLDSYNC_SCOPE,
  passwordChangeTokenBearer,
  sessionTokenBearer,
  stretchPasswordV2,
  unbundleKeyFetchResponse,
  unwrapKb,
  xorBytes,
} from '@libs/fxa-crypto';

import { ISignedUpAccount, signUpAccount } from '../../factories/account.factory';
import { bootstrapApp } from '../../setup';
import { keyIdHeader } from '../../utils/access-token';
import { dbQuery } from '../../utils/db';

const FIREFOX_CLIENT_ID = '5882386c6d801776';
const OLD_PASSWORD = 'old password for the change';
const NEW_PASSWORD = 'new password after the change';

interface IStartedChange {
  keyFetchToken2: string;
  passwordChangeToken: string;
  kB: Uint8Array<ArrayBuffer>;
}

describe('Password change (integration)', () => {
  let app: NestExpressApplication;
  let account: ISignedUpAccount;

  let webSession: string;
  let firefoxSession: string;
  let refreshToken: string;
  let accessToken: string;
  let authorizationCode: string;
  let codeVerifier: string;
  let keysChangedAt: number;
  let verifierSetAt: number;
  let newSession: string;

  const server = () => request(app.getHttpServer());

  const signIn = async (password: string, status: number, service?: string): Promise<request.Response> => {
    const stretched = await stretchPasswordV2(password, account.clientSalt);

    return server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: account.email, authPW: bytesToHex(stretched.authPW), service })
      .expect(status);
  };

  const fetchKb = async (keyFetchToken: string, password: string): Promise<string> => {
    const stretched = await stretchPasswordV2(password, account.clientSalt);
    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(keyFetchToken))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(keyFetchToken, keys.body.bundle);

    return bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey));
  };

  const start = async (sessionToken: string, oldPassword: string): Promise<IStartedChange> => {
    const stretched = await stretchPasswordV2(oldPassword, account.clientSalt);
    const response = await server()
      .post('/auth/v1/password/change/start')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ email: account.email, oldAuthPW: bytesToHex(stretched.authPW) })
      .expect(200);

    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(response.body.keyFetchToken2))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(response.body.keyFetchToken2, keys.body.bundle);

    return { ...response.body, kB: unwrapKb(bundle.wrapKb, stretched.unwrapBKey) };
  };

  const finishBody = async (started: IStartedChange, sessionToken: string, newPassword: string) => {
    const stretched = await stretchPasswordV2(newPassword, account.clientSalt);
    const { tokenId } = await deriveTokenKeys(sessionToken, 'sessionToken');

    return {
      authPW: randomBytes(32).toString('hex'),
      authPWVersion2: bytesToHex(stretched.authPW),
      wrapKbVersion2: bytesToHex(xorBytes(started.kB, stretched.unwrapBKey)),
      clientSalt: account.clientSalt,
      sessionToken: tokenId,
    };
  };

  const tokenserverRequest = (token: string) =>
    server()
      .get('/token/1.0/sync/1.5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-KeyID', keyIdHeader(keysChangedAt, 'aaaa'));

  beforeAll(async () => {
    app = await bootstrapApp();
    account = await signUpAccount(app, OLD_PASSWORD);
    webSession = account.sessionToken;

    const firefox = await signIn(OLD_PASSWORD, 200, 'sync');
    firefoxSession = firefox.body.sessionToken;

    await server()
      .post('/auth/v1/account/device')
      .set('Authorization', await sessionTokenBearer(firefoxSession))
      .send({ name: 'Firefox', type: 'desktop' })
      .expect(200);

    const granted = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', await sessionTokenBearer(firefoxSession))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        grant_type: 'fxa-credentials',
        scope: OLDSYNC_SCOPE,
        access_type: 'offline',
      })
      .expect(200);
    refreshToken = granted.body.refresh_token;
    accessToken = granted.body.access_token;

    codeVerifier = createCodeVerifier();
    const authorized = await server()
      .post('/auth/v1/oauth/authorization')
      .set('Authorization', await sessionTokenBearer(firefoxSession))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: 'state',
        response_type: 'code',
        scope: OLDSYNC_SCOPE,
        access_type: 'offline',
        code_challenge: await codeChallengeS256(codeVerifier),
        code_challenge_method: 'S256',
      })
      .expect(200);
    authorizationCode = authorized.body.code;

    const [user] = await dbQuery<{ keysChangedAt: number; verifierSetAt: number }>(
      app,
      'SELECT "keysChangedAt", "verifierSetAt" FROM "user" WHERE id = ?',
      [account.id]
    );
    keysChangedAt = user.keysChangedAt;
    verifierSetAt = user.verifierSetAt;

    await tokenserverRequest(accessToken).expect(200);
  });

  it('refuses to start with a wrong current password', async () => {
    const response = await server()
      .post('/auth/v1/password/change/start')
      .set('Authorization', await sessionTokenBearer(webSession))
      .send({ email: account.email, oldAuthPW: randomBytes(32).toString('hex') })
      .expect(400);

    expect(response.body.errno).toBe(103);
  });

  it('refuses to finish with a session of another account', async () => {
    const other = await signUpAccount(app, 'another account password');
    const started = await start(webSession, OLD_PASSWORD);

    const response = await server()
      .post('/auth/v1/password/change/finish')
      .set('Authorization', await passwordChangeTokenBearer(started.passwordChangeToken))
      .send(await finishBody(started, other.sessionToken, NEW_PASSWORD))
      .expect(401);

    expect(response.body).toMatchObject({ errno: 110, message: 'Invalid session token' });
  });

  it('changes the password with the same kB and signs the caller in again', async () => {
    const started = await start(webSession, OLD_PASSWORD);

    expect(bytesToHex(started.kB)).toBe(bytesToHex(account.kB));

    const body = await finishBody(started, webSession, NEW_PASSWORD);
    const finished = await server()
      .post('/auth/v1/password/change/finish?keys=true')
      .set('Authorization', await passwordChangeTokenBearer(started.passwordChangeToken))
      .send(body)
      .expect(200);

    expect(finished.body).toMatchObject({ uid: account.uid, verified: true });
    expect(finished.body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(finished.body.sessionToken).not.toBe(webSession);
    expect(typeof finished.body.authAt).toBe('number');
    newSession = finished.body.sessionToken;

    expect(await fetchKb(finished.body.keyFetchToken2, NEW_PASSWORD)).toBe(bytesToHex(account.kB));

    const reused = await server()
      .post('/auth/v1/password/change/finish')
      .set('Authorization', await passwordChangeTokenBearer(started.passwordChangeToken))
      .send(body)
      .expect(401);
    expect(reused.body.errno).toBe(110);
  });

  it('keeps keysChangedAt and raises verifierSetAt', async () => {
    const [user] = await dbQuery<{ keysChangedAt: number; verifierSetAt: number }>(
      app,
      'SELECT "keysChangedAt", "verifierSetAt" FROM "user" WHERE id = ?',
      [account.id]
    );

    expect(user.keysChangedAt).toBe(keysChangedAt);
    expect(user.verifierSetAt).toBeGreaterThan(verifierSetAt);
  });

  it('accepts only the new password, and the new password unwraps the same kB', async () => {
    expect((await signIn(OLD_PASSWORD, 400)).body.errno).toBe(103);

    const response = await signIn(NEW_PASSWORD, 200);

    expect(await fetchKb(response.body.keyFetchTokenVersion2, NEW_PASSWORD)).toBe(bytesToHex(account.kB));
  });

  it('ends every other session and its device, and keeps the new one', async () => {
    for (const session of [webSession, firefoxSession]) {
      const response = await server()
        .get('/auth/v1/session/status')
        .set('Authorization', await sessionTokenBearer(session))
        .expect(401);

      expect(response.body.errno).toBe(110);
    }

    const devices = await dbQuery(app, 'SELECT id FROM device WHERE "userId" = ?', [account.id]);
    expect(devices).toHaveLength(0);

    await server()
      .get('/auth/v1/session/status')
      .set('Authorization', await sessionTokenBearer(newSession))
      .expect(200);

    const { tokenId } = await deriveTokenKeys(newSession, 'sessionToken');
    await server().get('/api/v1/user/profile').set('Authorization', `Bearer fxs_${tokenId}`).expect(200);
  });

  it('revokes the refresh token and the access token', async () => {
    const refreshed = await server()
      .post('/auth/v1/oauth/token')
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken })
      .expect(401);
    expect(refreshed.body.errno).toBe(110);

    await server().post('/oauth/v1/verify').send({ token: accessToken }).expect(401);
  });

  it('refuses an authorization code issued before the change', async () => {
    const redeemed = await server()
      .post('/auth/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: authorizationCode,
        client_id: FIREFOX_CLIENT_ID,
        code_verifier: codeVerifier,
      })
      .expect(400);

    expect(redeemed.body.errno).toBe(172);
  });

  it('makes the tokenserver refuse access tokens minted before the change, whose records it revoked', async () => {
    const refused = await tokenserverRequest(accessToken).expect(401);
    expect(refused.body.status).toBe('invalid-credentials');

    const granted = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', await sessionTokenBearer(newSession))
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'fxa-credentials', scope: OLDSYNC_SCOPE })
      .expect(200);

    await tokenserverRequest(granted.body.access_token).expect(200);
  });
});
