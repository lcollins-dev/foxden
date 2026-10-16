import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { SessionListResponseDto } from '@libs/dto';
import { codeChallengeS256, createCodeVerifier, OLDSYNC_SCOPE } from '@libs/fxa-crypto';

import { deleteSession, listSessions, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const ANDROID_CLIENT_ID = 'a2270f727f45f648';
const IOS_CLIENT_ID = '1b1a3e44c54fbb58';

const DAY_MS = 24 * 60 * 60 * 1000;

interface IMobileSignIn {
  /** The sign-in page's session, which Firefox for Android keeps from `fxaccounts:login`. */
  pageSession: string;
  web: string;
  refreshToken: string;
}

describe('Firefox for Android on the device routes (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  const server = () => request(app.getHttpServer());

  const bearer = (refreshToken: string) => ({ Authorization: `Bearer ${refreshToken}` });

  /** What application-services fxa-client does after our page hands it a code: exchange it without a session. */
  const signIn = async (scope = `profile ${OLDSYNC_SCOPE}`, clientId = ANDROID_CLIENT_ID): Promise<IMobileSignIn> => {
    const account = await createTestUser(app);
    const pageSession = await login(app, account.email);
    const web = await login(app, account.email);
    const codeVerifier = createCodeVerifier();

    const authorized = await server()
      .post('/auth/v1/oauth/authorization')
      .set(authHeaders(pageSession))
      .send({
        client_id: clientId,
        state: 'state',
        scope,
        access_type: 'offline',
        code_challenge: await codeChallengeS256(codeVerifier),
        code_challenge_method: 'S256',
      })
      .expect(200);

    const granted = await server()
      .post('/auth/v1/oauth/token')
      .send({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: authorized.body.code,
        code_verifier: codeVerifier,
      })
      .expect(200);

    return { pageSession, web, refreshToken: granted.body.refresh_token };
  };

  const registerDevice = (refreshToken: string) =>
    server()
      .post('/auth/v1/account/device')
      .set(bearer(refreshToken))
      .send({
        name: 'Firefox on Pixel',
        type: 'mobile',
        availableCommands: { 'https://identity.mozilla.com/cmd/open-uri': '{"kid":"k"}' },
      });

  it('registers, lists and polls the device of the session the refresh token came from', async () => {
    const signed = await signIn();

    const registered = await registerDevice(signed.refreshToken).expect(200);
    expect(registered.body).toMatchObject({
      name: 'Firefox on Pixel',
      type: 'mobile',
      pushEndpointExpired: false,
      availableCommands: { 'https://identity.mozilla.com/cmd/open-uri': '{"kid":"k"}' },
    });

    const devices = await server()
      .get('/auth/v1/account/devices?filterIdleDevicesTimestamp=0')
      .set(bearer(signed.refreshToken))
      .expect(200);
    expect(devices.body).toEqual([
      expect.objectContaining({ id: registered.body.id, isCurrentDevice: true, location: {} }),
    ]);

    const fromPageSession = await server().get('/auth/v1/account/devices').set(authHeaders(signed.pageSession));
    expect(fromPageSession.body[0]).toMatchObject({ id: registered.body.id, isCurrentDevice: true });

    await server().get('/auth/v1/account/device/commands?index=0').set(bearer(signed.refreshToken)).expect(200);

    const updated = await server()
      .post('/auth/v1/account/device')
      .set(bearer(signed.refreshToken))
      .send({ pushCallback: '', pushPublicKey: '', pushAuthKey: '' })
      .expect(200);
    expect(updated.body.id).toBe(registered.body.id);
  });

  it('takes Firefox for iOS registering a tablet with push turned off', async () => {
    const signed = await signIn(`profile ${OLDSYNC_SCOPE}`, IOS_CLIENT_ID);

    const registered = await server()
      .post('/auth/v1/account/device')
      .set(bearer(signed.refreshToken))
      .send({ name: 'Firefox on iPad', type: 'tablet', pushCallback: '', pushPublicKey: '', pushAuthKey: '' })
      .expect(200);

    expect(registered.body).toMatchObject({ name: 'Firefox on iPad', type: 'tablet', pushEndpointExpired: false });
  });

  it('lists the device once among the attached clients and introspects the refresh token as fxa-client asks', async () => {
    const signed = await signIn();
    const registered = await registerDevice(signed.refreshToken).expect(200);

    const attached = await server()
      .get('/auth/v1/account/attached_clients')
      .set(bearer(signed.refreshToken))
      .expect(200);
    expect(attached.body).toHaveLength(2);
    expect(attached.body).toContainEqual(
      expect.objectContaining({ clientId: ANDROID_CLIENT_ID, deviceId: registered.body.id, isCurrentSession: true })
    );

    const introspected = await server()
      .post('/oauth/v1/introspect')
      .send({ token: signed.refreshToken, token_type_hint: 'refresh_token' })
      .expect(200);
    expect(introspected.body).toMatchObject({
      active: true,
      token_type: 'refresh_token',
      client_id: ANDROID_CLIENT_ID,
    });
  });

  it('leaves a device idle past filterIdleDevicesTimestamp out of the lists Firefox for Android asks for', async () => {
    const signed = await signIn();
    const mobile = (await registerDevice(signed.refreshToken).expect(200)).body;
    const desktop = (
      await server().post('/auth/v1/account/device').set(authHeaders(signed.web)).send({ name: 'Desktop' }).expect(200)
    ).body;

    const longAgo = Date.now() - 30 * DAY_MS;
    await dbQuery(app, 'UPDATE device SET "lastAccessAt" = ? WHERE id = ?', [longAgo, desktop.id]);
    await dbQuery(
      app,
      'UPDATE session SET "lastAccessAt" = ? WHERE id = (SELECT "sessionId" FROM device WHERE id = ?)',
      [longAgo, desktop.id]
    );

    // What application-services fxa-client sends (fxa-client/src/internal/http_client.rs, DEVICES_FILTER_DAYS).
    const filter = `filterIdleDevicesTimestamp=${Date.now() - 21 * DAY_MS}`;

    const filtered = await server()
      .get(`/auth/v1/account/devices?${filter}`)
      .set(bearer(signed.refreshToken))
      .expect(200);
    expect(filtered.body.map((device: { id: string }) => device.id)).toEqual([mobile.id]);

    const attached = await server()
      .get(`/auth/v1/account/attached_clients?${filter}`)
      .set(authHeaders(signed.pageSession))
      .expect(200);
    expect(attached.body.map((client: { deviceId: string | null }) => client.deviceId)).not.toContain(desktop.id);

    const malformed = await server()
      .get('/auth/v1/account/devices?filterIdleDevicesTimestamp=yesterday')
      .set(bearer(signed.refreshToken))
      .expect(400);
    expect(malformed.body).toMatchObject({ errno: 107 });

    const unknown = await server()
      .get('/auth/v1/account/attached_clients?filterIdleDevices=1')
      .set(authHeaders(signed.pageSession))
      .expect(400);
    expect(unknown.body).toMatchObject({ errno: 107 });
  });

  it('refuses a refresh token without the Sync scope and one it does not know with errno 110', async () => {
    const profileOnly = await signIn('profile');

    expect((await registerDevice(profileOnly.refreshToken).expect(401)).body.errno).toBe(110);
    expect((await registerDevice('e'.repeat(64)).expect(401)).body.errno).toBe(110);
  });

  it('signs the session out when the device destroys itself, revoking the refresh token', async () => {
    const signed = await signIn();
    const { id } = (await registerDevice(signed.refreshToken).expect(200)).body;

    await server().post('/auth/v1/account/device/destroy').set(bearer(signed.refreshToken)).send({ id }).expect(200);

    await server()
      .post('/oauth/v1/token')
      .send({ client_id: ANDROID_CLIENT_ID, grant_type: 'refresh_token', refresh_token: signed.refreshToken })
      .expect(401);
    await server().get('/auth/v1/account/devices').set(bearer(signed.refreshToken)).expect(401);
    await server().get('/auth/v1/session/status').set(authHeaders(signed.pageSession)).expect(401);
  });

  it('shuts the device routes once the Devices page signs the session out', async () => {
    const signed = await signIn();
    await registerDevice(signed.refreshToken).expect(200);

    const sessions = ((await listSessions(app, signed.web).expect(200)).body as SessionListResponseDto).sessionList;
    const mobile = sessions.find(session => session.device?.type === 'mobile');
    expect(mobile).toBeDefined();

    await deleteSession(app, signed.web, mobile?.id ?? 0).expect(200);

    expect((await registerDevice(signed.refreshToken).expect(401)).body.errno).toBe(110);
  });
});
