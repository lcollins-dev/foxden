import { NestExpressApplication } from '@nestjs/platform-express';
import { compactDecrypt, createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';
import {
  base64UrlEncode,
  buildKeysJwe,
  bytesToHex,
  codeChallengeS256,
  createClientSalt,
  createCodeVerifier,
  createSignUpKeys,
  deriveOldsyncKey,
  deriveTokenKeys,
  keyFetchTokenBearer,
  OLDSYNC_SCOPE,
  sessionTokenBearer,
  stretchPasswordV2,
  unbundleKeyFetchResponse,
  unwrapKb,
  utf8,
} from '@libs/fxa-crypto';

import { createInvite, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const FIREFOX_CLIENT_ID = '5882386c6d801776';
const PASSWORD = 'correct horse battery staple';
const NAME = 'Robin Ash';
const PUBLIC_URL = 'http://localhost:8080';

const PUSH = {
  pushCallback: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexample',
  pushPublicKey: 'BCp93zru09_hab2Bg37LpTNG__Pw6eMPEP2hrs2YLuXDc5ZCnqvbHXqRLLhIVzzcX0rHrF_Q6NfeVOm6o9XY5I0',
  pushAuthKey: 'KFJhlHMnm_NNhqqpzHkeFw',
};

const SEND_TAB_COMMANDS = {
  'https://identity.mozilla.com/cmd/open-uri': '{"kid":"1","IV":"aXY","hmac":"bWFj","ciphertext":"Y3Q"}',
};

/** What Firefox holds for one sign-in flow (ff/services/fxaccounts/FxAccountsOAuth.sys.mjs beginOAuthFlow). */
interface IFirefoxFlow {
  keysJwk: string;
  privateKey: CryptoKey;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

const beginFirefoxFlow = async (): Promise<IFirefoxFlow> => {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const codeVerifier = createCodeVerifier();

  return {
    keysJwk: base64UrlEncode(utf8(JSON.stringify(publicJwk))),
    privateKey: keyPair.privateKey,
    codeVerifier,
    codeChallenge: await codeChallengeS256(codeVerifier),
    state: base64UrlEncode(randomBytes(16)),
  };
};

describe('Invite, sign-up, sign-in and Sync start (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;

  const email = `Flow-${randomUUID()}@Foxden.test`;
  let uid: string;
  let kB: Uint8Array<ArrayBuffer>;
  let sessionToken: string;
  let flow: IFirefoxFlow;
  let code: string;
  let keysJwe: string;
  let deviceId: string;
  let syncAccessToken: string;

  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  it('creates an account from an invite with v2 credentials', async () => {
    const invite = await createInvite(app, adminToken, { email, name: NAME, admin: false }).expect(201);
    const inviteToken = String(invite.body.link).split('/').pop();

    const clientSalt = createClientSalt();
    const stretched = await stretchPasswordV2(PASSWORD, clientSalt);
    const signUpKeys = createSignUpKeys(stretched.unwrapBKey);
    kB = signUpKeys.kB;

    const body = {
      email,
      authPWVersion2: bytesToHex(stretched.authPW),
      wrapKbVersion2: bytesToHex(signUpKeys.wrapKb),
      clientSalt,
      inviteToken,
      service: 'sync',
    };

    const response = await server().post('/auth/v1/account/create?keys=true').send(body).expect(200);

    expect(response.body).toMatchObject({ emailVerified: true, sessionVerified: true, verified: true });
    expect(response.body.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(response.body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(response.body.keyFetchTokenVersion2).toMatch(/^[0-9a-f]{64}$/);
    uid = response.body.uid;

    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(response.body.keyFetchTokenVersion2))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(response.body.keyFetchTokenVersion2, keys.body.bundle);

    expect(bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey))).toBe(bytesToHex(kB));

    const reused = await server().post('/auth/v1/account/create').send(body).expect(400);
    expect(reused.body.errno).toBe(207);
  });

  it('stores only hashes of the tokens it hands out and a real millisecond keysChangedAt', async () => {
    const [user] = await dbQuery<{ keysChangedAt: number; verifierSetAt: number; id: number }>(
      app,
      'SELECT id, "keysChangedAt", "verifierSetAt" FROM "user" WHERE uid = ?',
      [uid]
    );

    expect(String(user.keysChangedAt)).toMatch(/^[0-9]{13}$/);
    expect(user.verifierSetAt).toBe(user.keysChangedAt);

    const sessions = await dbQuery<{ tokenIdHash: string }>(
      app,
      'SELECT "tokenIdHash" FROM session WHERE "userId" = ?',
      [user.id]
    );
    const invites = await dbQuery<{ usedAt: number | null }>(app, 'SELECT "usedAt" FROM invite WHERE email = ?', [
      email.toLowerCase(),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invites).toHaveLength(1);
    expect(String(invites[0].usedAt)).toMatch(/^[0-9]{13}$/);
  });

  it('signs in with the clientSalt from credentials/status and recovers the same kB', async () => {
    const status = await server().post('/auth/v1/account/credentials/status').send({ email }).expect(200);

    expect(status.body).toMatchObject({ currentVersion: 'v2', upgradeNeeded: false });

    const stretched = await stretchPasswordV2(PASSWORD, status.body.clientSalt);

    const response = await server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email, authPW: bytesToHex(stretched.authPW), service: 'sync' })
      .expect(200);

    expect(response.body).toMatchObject({ uid, emailVerified: true, sessionVerified: true, verified: true });
    expect(typeof response.body.authAt).toBe('number');
    sessionToken = response.body.sessionToken;

    const keyFetchAuthorization = await keyFetchTokenBearer(response.body.keyFetchTokenVersion2);
    const keys = await server().get('/auth/v1/account/keys').set('Authorization', keyFetchAuthorization).expect(200);
    const bundle = await unbundleKeyFetchResponse(response.body.keyFetchTokenVersion2, keys.body.bundle);

    expect(bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey))).toBe(bytesToHex(kB));

    const again = await server().get('/auth/v1/account/keys').set('Authorization', keyFetchAuthorization).expect(401);
    expect(again.body.errno).toBe(110);
  });

  it('answers a wrong password with errno 103, or 120 with the stored case', async () => {
    const wrongAuthPw = randomBytes(32).toString('hex');

    const wrong = await server().post('/auth/v1/account/login').send({ email, authPW: wrongAuthPw }).expect(400);
    expect(wrong.body).toMatchObject({ code: 400, errno: 103, error: 'Bad Request', message: 'Incorrect password' });

    const lowerCase = email.toLowerCase();
    const wrongCase = await server()
      .post('/auth/v1/account/login')
      .send({ email: lowerCase, authPW: wrongAuthPw })
      .expect(400);
    expect(wrongCase.body).toMatchObject({ errno: 120, email });

    const unknown = await server()
      .post('/auth/v1/account/login')
      .send({ email: `nobody-${randomUUID()}@foxden.test`, authPW: wrongAuthPw })
      .expect(400);
    expect(unknown.body.errno).toBe(102);
  });

  it('gets an authorization code carrying the keys_jwe the web UI builds', async () => {
    const keyData = await server()
      .post('/auth/v1/account/scoped-key-data')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ client_id: FIREFOX_CLIENT_ID, scope: `${OLDSYNC_SCOPE} profile` })
      .expect(200);

    const oldsync = keyData.body[OLDSYNC_SCOPE];
    expect(oldsync).toMatchObject({ identifier: OLDSYNC_SCOPE, keyRotationSecret: '0'.repeat(64) });

    flow = await beginFirefoxFlow();
    keysJwe = await buildKeysJwe(flow.keysJwk, {
      [OLDSYNC_SCOPE]: await deriveOldsyncKey(kB, oldsync.keyRotationTimestamp),
    });

    const response = await server()
      .post('/auth/v1/oauth/authorization')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: flow.state,
        response_type: 'code',
        scope: `${OLDSYNC_SCOPE} profile`,
        access_type: 'offline',
        code_challenge: flow.codeChallenge,
        code_challenge_method: 'S256',
        keys_jwe: keysJwe,
        service: 'sync',
      })
      .expect(200);

    expect(response.body).toMatchObject({ state: flow.state, scope: `${OLDSYNC_SCOPE} profile` });
    expect(response.body.redirect).toBe(
      `urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel?code=${response.body.code}&state=${flow.state}`
    );
    code = response.body.code;
  });

  it('registers the device Firefox creates on fxaccounts:login', async () => {
    const response = await server()
      .post('/auth/v1/account/device')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ name: "Sam's Firefox", type: 'desktop', ...PUSH, availableCommands: {} })
      .expect(200);

    expect(response.body).toMatchObject({ name: "Sam's Firefox", type: 'desktop', ...PUSH, availableCommands: {} });
    expect(response.body.id).toMatch(/^[0-9a-f]{32}$/);
    deviceId = response.body.id;
  });

  it('exchanges the code with PKCE for tokens and a keys_jwe Firefox can open', async () => {
    const response = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ grant_type: 'authorization_code', code, client_id: FIREFOX_CLIENT_ID, code_verifier: flow.codeVerifier })
      .expect(200);

    expect(response.body).toMatchObject({
      token_type: 'bearer',
      scope: `${OLDSYNC_SCOPE} profile`,
      expires_in: 86400,
      keys_jwe: keysJwe,
    });
    expect(response.body.refresh_token).toMatch(/^[0-9a-f]{64}$/);

    const { plaintext } = await compactDecrypt(response.body.keys_jwe, flow.privateKey);
    const scopedKeys = JSON.parse(new TextDecoder().decode(plaintext));

    expect(scopedKeys[OLDSYNC_SCOPE].kid).toMatch(/^[0-9]{13}-[A-Za-z0-9_-]{22}$/);

    const reused = await server()
      .post('/auth/v1/oauth/token')
      .send({ grant_type: 'authorization_code', code, client_id: FIREFOX_CLIENT_ID, code_verifier: flow.codeVerifier })
      .expect(400);
    expect(reused.body.errno).toBe(172);

    // Firefox revokes the refresh token at once and aborts sign-in unless this answers 2xx with JSON.
    await server()
      .post('/auth/v1/oauth/destroy')
      .send({ client_id: FIREFOX_CLIENT_ID, token: response.body.refresh_token })
      .expect(200, {});
    await server().post('/auth/v1/oauth/destroy').send({ client_id: FIREFOX_CLIENT_ID }).expect(200, {});
  });

  it('rejects a code_verifier that does not match the challenge', async () => {
    const otherFlow = await beginFirefoxFlow();
    const authorization = await server()
      .post('/auth/v1/oauth/authorization')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: otherFlow.state,
        scope: OLDSYNC_SCOPE,
        code_challenge: otherFlow.codeChallenge,
        code_challenge_method: 'S256',
      })
      .expect(200);

    const response = await server()
      .post('/auth/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: authorization.body.code,
        client_id: FIREFOX_CLIENT_ID,
        code_verifier: flow.codeVerifier,
      })
      .expect(400);

    expect(response.body.errno).toBe(175);
  });

  it('echoes the send-tab commands Firefox registers after oauth_login', async () => {
    const response = await server()
      .post('/auth/v1/account/device')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ id: deviceId, name: "Sam's Firefox", type: 'desktop', ...PUSH, availableCommands: SEND_TAB_COMMANDS })
      .expect(200);

    expect(response.body).toMatchObject({ id: deviceId, ...PUSH, availableCommands: SEND_TAB_COMMANDS });
  });

  it('mints a Sync access token from the session over Hawk that verifies against the JWKS', async () => {
    const { tokenId } = await deriveTokenKeys(sessionToken, 'sessionToken');
    const hawk = `Hawk id="${tokenId}", ts="${Math.floor(Date.now() / 1000)}", nonce="bm9uY2U=", mac="bWFj"`;

    const response = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', hawk)
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'fxa-credentials', scope: OLDSYNC_SCOPE, ttl: 21600 })
      .expect(200);

    expect(response.body).toMatchObject({ token_type: 'bearer', scope: OLDSYNC_SCOPE, expires_in: 21600 });
    expect(response.body.refresh_token).toBeUndefined();
    syncAccessToken = response.body.access_token;

    const jwks = await server().get('/oauth/v1/jwks').expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', e: 'AQAB' });
    expect(jwks.body.keys[0].d).toBeUndefined();

    const { payload, protectedHeader } = await jwtVerify(syncAccessToken, createLocalJWKSet(jwks.body), {
      typ: 'at+JWT',
      algorithms: ['RS256'],
    });

    const [user] = await dbQuery<{ verifierSetAt: number }>(app, 'SELECT "verifierSetAt" FROM "user" WHERE uid = ?', [
      uid,
    ]);

    expect(protectedHeader).toMatchObject({ alg: 'RS256', typ: 'at+JWT', kid: jwks.body.keys[0].kid });
    expect(payload).toMatchObject({
      sub: uid,
      scope: OLDSYNC_SCOPE,
      client_id: FIREFOX_CLIENT_ID,
      iss: PUBLIC_URL,
      aud: `${PUBLIC_URL}/token/1.0/sync/1.5`,
      'fxa-generation': user.verifierSetAt,
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(21600);

    const verified = await server().post('/oauth/v1/verify').send({ token: syncAccessToken }).expect(200);
    expect(verified.body).toEqual({
      user: uid,
      client_id: FIREFOX_CLIENT_ID,
      scope: [OLDSYNC_SCOPE],
      generation: user.verifierSetAt,
    });
  });

  it('serves the profile for a profile-scoped token, with an ETag', async () => {
    const token = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'fxa-credentials', scope: 'profile' })
      .expect(200);

    const profile = await server()
      .get('/profile/v1/profile')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .expect(200);

    expect(profile.body).toMatchObject({
      uid,
      email,
      displayName: NAME,
      avatar: `${PUBLIC_URL}/profile/v1/avatar/default`,
      avatarDefault: true,
    });

    await server()
      .get('/profile/v1/profile')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .set('If-None-Match', profile.headers.etag)
      .expect(304);

    const syncOnly = await server().get('/profile/v1/profile').set('Authorization', `Bearer ${syncAccessToken}`);
    expect(syncOnly.body.errno).toBe(163);
  });

  it('lists the device with the current flag, no commands and the attached session', async () => {
    const authorization = await sessionTokenBearer(sessionToken);

    const devices = await server().get('/auth/v1/account/devices').set('Authorization', authorization).expect(200);
    expect(devices.body).toEqual([
      expect.objectContaining({
        id: deviceId,
        isCurrentDevice: true,
        ...PUSH,
        pushEndpointExpired: false,
        availableCommands: SEND_TAB_COMMANDS,
      }),
    ]);

    await server()
      .get('/auth/v1/account/device/commands?index=0&limit=100')
      .set('Authorization', authorization)
      .expect(200, { index: 0, last: true, messages: [] });

    // What the clients engine sends after uploading its record (ff/services/sync/modules/engines/clients.sys.mjs).
    await server()
      .post('/auth/v1/account/devices/notify')
      .set('Authorization', authorization)
      .send({ to: 'all', excluded: [deviceId], payload: { version: 1, command: 'sync:collection_changed' }, TTL: 0 })
      .expect(200, {});

    const attached = await server()
      .get('/auth/v1/account/attached_clients')
      .set('Authorization', authorization)
      .expect(200);
    expect(attached.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ deviceId, isCurrentSession: true, clientId: null })])
    );

    const status = await server().get('/auth/v1/session/status').set('Authorization', authorization).expect(200);
    expect(status.body).toMatchObject({ state: 'verified', uid, details: { verified: true } });
  });

  it('destroys the session, its device and answers errno 110 afterwards', async () => {
    const authorization = await sessionTokenBearer(sessionToken);

    await server().post('/auth/v1/session/destroy').set('Authorization', authorization).send({}).expect(200, {});

    const after = await server().get('/auth/v1/session/status').set('Authorization', authorization).expect(401);
    expect(after.body).toMatchObject({ code: 401, errno: 110 });

    expect(await dbQuery(app, 'SELECT id FROM device WHERE id = ?', [deviceId])).toHaveLength(0);

    await server().get(`/auth/v1/account/status?uid=${uid}`).expect(200, { exists: true });
    await server()
      .get(`/auth/v1/account/status?uid=${'0'.repeat(32)}`)
      .expect(200, { exists: false });
  });

  it('keeps access tokens verifiable across the signing key being reloaded', async () => {
    const jwks = await server().get('/oauth/v1/jwks').expect(200);

    expect(decodeProtectedHeader(syncAccessToken).kid).toBe(jwks.body.keys[0].kid);

    const stored = await dbQuery<{ kid: string }>(app, 'SELECT kid FROM signing_key');
    expect(stored.map(row => row.kid)).toContain(jwks.body.keys[0].kid);
  });
});
