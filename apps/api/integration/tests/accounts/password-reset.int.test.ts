import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';
import {
  bytesToHex,
  createPasswordCredentials,
  deriveTokenKeys,
  keyFetchTokenBearer,
  OLDSYNC_SCOPE,
  sessionTokenBearer,
  stretchPasswordV2,
  unbundleKeyFetchResponse,
  unwrapKb,
} from '@libs/fxa-crypto';

import { TokenserverService } from '@/core/tokenserver/tokenserver.service';

import { createPasswordReset, getUser, login, updateUserState } from '../../clients/user.client';
import { ISignedUpAccount, signUpAccount } from '../../factories/account.factory';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { keyIdHeader } from '../../utils/access-token';
import { dbQuery } from '../../utils/db';
import { IStorageCredentials, storageRequest, syncTokenCredentials } from '../../utils/hawk';

const FIREFOX_CLIENT_ID = '5882386c6d801776';
const OLD_PASSWORD = 'password forgotten before the reset';
const NEW_PASSWORD = 'password chosen on the reset page';
const OLD_CLIENT_STATE = 'aaaa';
const NEW_CLIENT_STATE = 'bbbb';

const resetTokenOf = (link: string): string => link.split('/').pop() ?? '';

describe('Password reset (integration)', () => {
  let app: NestExpressApplication;
  let account: ISignedUpAccount;
  let adminToken: string;

  let firefoxSession: string;
  let refreshToken: string;
  let accessToken: string;
  let storage: IStorageCredentials;
  let keysChangedAt: number;
  let kA: string;

  let resetToken: string;
  let newSession: string;

  const server = () => request(app.getHttpServer());

  const check = (token: string) => server().post('/api/v1/password-reset/check').send({ token });

  const reset = async (token: string, password: string) =>
    server()
      .post('/api/v1/password-reset')
      .send({ token, ...(await createPasswordCredentials(password)) });

  const INVALID_LINK = {
    statusCode: 400,
    message: "This reset link doesn't work any more. Ask your admin for a new one.",
  };

  const signIn = async (password: string, status: number): Promise<request.Response> => {
    const credentials = await server().post('/auth/v1/account/credentials/status').send({ email: account.email });
    const stretched = await stretchPasswordV2(password, credentials.body.clientSalt);

    return server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: account.email, authPW: bytesToHex(stretched.authPW), service: 'sync' })
      .expect(status);
  };

  const fetchKb = async (keyFetchToken: string, password: string): Promise<string> => {
    const status = await server().post('/auth/v1/account/credentials/status').send({ email: account.email });
    const stretched = await stretchPasswordV2(password, status.body.clientSalt);
    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(keyFetchToken))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(keyFetchToken, keys.body.bundle);

    return bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey));
  };

  const grantAccessToken = async (sessionToken: string): Promise<request.Response> =>
    server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', await sessionTokenBearer(sessionToken))
      .send({
        client_id: FIREFOX_CLIENT_ID,
        grant_type: 'fxa-credentials',
        scope: OLDSYNC_SCOPE,
        access_type: 'offline',
      })
      .expect(200);

  const exchangeToken = (token: string, keysChanged: number, clientState: string) =>
    server()
      .get('/token/1.0/sync/1.5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-KeyID', keyIdHeader(keysChanged, clientState));

  const readKeys = async () => {
    const [user] = await dbQuery<{ keysChangedAt: number; kA: string }>(
      app,
      'SELECT "keysChangedAt", "kA" FROM "user" WHERE id = ?',
      [account.id]
    );

    return user;
  };

  beforeAll(async () => {
    app = await bootstrapApp();
    account = await signUpAccount(app, OLD_PASSWORD);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    adminToken = await login(app, admin.email);

    firefoxSession = (await signIn(OLD_PASSWORD, 200)).body.sessionToken;

    await server()
      .post('/auth/v1/account/device')
      .set('Authorization', await sessionTokenBearer(firefoxSession))
      .send({ name: 'Firefox', type: 'desktop' })
      .expect(200);

    const granted = await grantAccessToken(firefoxSession);
    refreshToken = granted.body.refresh_token;
    accessToken = granted.body.access_token;

    ({ keysChangedAt, kA } = await readKeys());

    storage = syncTokenCredentials(
      (await exchangeToken(accessToken, keysChangedAt, OLD_CLIENT_STATE).expect(200)).body
    );
    await storageRequest(app, storage, 'put', '/storage/bookmarks/a')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ payload: 'encrypted under the old kB' }))
      .expect(200);
  });

  describe('creating a link', () => {
    it('answers the link once and stores only a hash of its token', async () => {
      const created = await createPasswordReset(app, adminToken, account.id).expect(201);

      expect(created.body.link).toMatch(/^http:\/\/localhost:8080\/reset-password\/[0-9a-f]{64}$/);
      expect(Date.parse(created.body.expiresAt)).toBeGreaterThan(Date.now());

      const token = resetTokenOf(created.body.link);
      const rows = await dbQuery<{ tokenHash: string }>(
        app,
        'SELECT "tokenHash" FROM password_reset WHERE "userId" = ?',
        [account.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toContain(token);

      expect((await getUser(app, adminToken, account.id).expect(200)).body.passwordResetExpiresAt).toBe(
        created.body.expiresAt
      );
    });

    it('replaces the earlier unused link with a new one', async () => {
      const first = resetTokenOf((await createPasswordReset(app, adminToken, account.id).expect(201)).body.link);
      const second = resetTokenOf((await createPasswordReset(app, adminToken, account.id).expect(201)).body.link);

      expect((await check(first).expect(200)).body).toEqual({ state: 'invalid', passwordReset: null });
      expect((await check(second).expect(200)).body.state).toBe('valid');
    });
  });

  describe('using a link', () => {
    it('shows the account address while the link is valid', async () => {
      resetToken = resetTokenOf((await createPasswordReset(app, adminToken, account.id).expect(201)).body.link);

      expect((await check(resetToken).expect(200)).body).toMatchObject({
        state: 'valid',
        passwordReset: { email: account.email },
      });
    });

    it('sets the new password and answers a session the web app can use', async () => {
      const response = await reset(resetToken, NEW_PASSWORD);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['sessionToken']);
      newSession = response.body.sessionToken;

      const { tokenId } = await deriveTokenKeys(newSession, 'sessionToken');
      await server().get('/api/v1/user/profile').set('Authorization', `Bearer fxs_${tokenId}`).expect(200);
    });

    it('re-keys the account: a new kA and keysChangedAt, and a kB the old one is not', async () => {
      const keys = await readKeys();

      expect(keys.keysChangedAt).toBeGreaterThan(keysChangedAt);
      expect(keys.kA).not.toBe(kA);

      expect((await signIn(OLD_PASSWORD, 400)).body.errno).toBe(103);

      const signedIn = await signIn(NEW_PASSWORD, 200);
      expect(await fetchKb(signedIn.body.keyFetchTokenVersion2, NEW_PASSWORD)).not.toBe(bytesToHex(account.kB));
    });

    it('signs Firefox out and revokes its refresh and access tokens', async () => {
      const status = await server()
        .get('/auth/v1/session/status')
        .set('Authorization', await sessionTokenBearer(firefoxSession))
        .expect(401);
      expect(status.body.errno).toBe(110);

      const refreshed = await server()
        .post('/auth/v1/oauth/token')
        .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken })
        .expect(401);
      expect(refreshed.body.errno).toBe(110);

      await exchangeToken(accessToken, keysChangedAt, OLD_CLIENT_STATE).expect(401);
    });

    it('wipes the storage at once and refuses the storage token issued before the reset', async () => {
      const bsos = await dbQuery(app, 'SELECT id FROM storage_bso WHERE uid = ?', [storage.uid]);
      expect(bsos).toHaveLength(0);

      await storageRequest(app, storage, 'get', '/storage/bookmarks/a').expect(401);
    });

    it('gives Firefox a fresh, empty uid once it signs in again with the new keys', async () => {
      const { keysChangedAt: newKeysChangedAt } = await readKeys();
      const granted = await grantAccessToken(newSession);

      const exchanged = await exchangeToken(granted.body.access_token, newKeysChangedAt, NEW_CLIENT_STATE).expect(200);
      const fresh = syncTokenCredentials(exchanged.body);

      expect(fresh.uid).not.toBe(storage.uid);
      expect((await storageRequest(app, fresh, 'get', '/info/collections').expect(200)).body).toEqual({});

      await exchangeToken(granted.body.access_token, newKeysChangedAt, OLD_CLIENT_STATE).expect(401);
    });

    it('reads the link as used and refuses it a second time', async () => {
      expect((await check(resetToken).expect(200)).body).toEqual({ state: 'used', passwordReset: null });
      expect((await reset(resetToken, 'a third password')).body).toMatchObject(INVALID_LINK);
      expect((await getUser(app, adminToken, account.id).expect(200)).body.passwordResetExpiresAt).toBeNull();
    });
  });

  describe('a link that cannot be used', () => {
    it('reads an expired link as expired and refuses it', async () => {
      const other = await signUpAccount(app, 'expired link password');
      const token = resetTokenOf((await createPasswordReset(app, adminToken, other.id).expect(201)).body.link);
      await dbQuery(app, 'UPDATE password_reset SET "expiresAt" = ? WHERE "userId" = ?', [Date.now() - 1, other.id]);

      expect((await check(token).expect(200)).body.state).toBe('expired');
      expect((await reset(token, NEW_PASSWORD)).body).toMatchObject(INVALID_LINK);
    });

    it('reads an unknown link as invalid and refuses it', async () => {
      const token = 'f'.repeat(64);

      expect((await check(token).expect(200)).body.state).toBe('invalid');
      expect((await reset(token, NEW_PASSWORD)).body).toMatchObject(INVALID_LINK);
    });

    it('revokes the link when the account is disabled, and enabling it again does not revive the link', async () => {
      const other = await signUpAccount(app, 'disabled later password');
      const token = resetTokenOf((await createPasswordReset(app, adminToken, other.id).expect(201)).body.link);

      await updateUserState(app, adminToken, other.id, { enabled: false }).expect(200);
      await updateUserState(app, adminToken, other.id, { enabled: true }).expect(200);

      expect((await check(token).expect(200)).body.state).toBe('invalid');
      expect((await reset(token, NEW_PASSWORD)).body).toMatchObject(INVALID_LINK);
    });
  });

  describe('edge cases', () => {
    it('raises the generation of a password change made after a reset replaced every row', async () => {
      const fxaUid = randomBytes(16).toString('hex');
      await dbQuery(
        app,
        `INSERT INTO tokenserver_user (fxa_uid, generation, client_state, keys_changed_at, created_at)
         VALUES (?, 100, 'aaaa', 100, 1)`,
        [fxaUid]
      );

      await app.get(TokenserverService).recordKeyChange(fxaUid, 200);
      await app.get(TokenserverService).recordPasswordChange(fxaUid, 300);

      const rows = await dbQuery<{ generation: number }>(
        app,
        'SELECT generation FROM tokenserver_user WHERE fxa_uid = ?',
        [fxaUid]
      );
      expect(Math.max(...rows.map(row => row.generation))).toBe(299);
    });

    it('refuses a malformed token, authPw or client salt before looking anything up', async () => {
      const credentials = await createPasswordCredentials(NEW_PASSWORD);

      await check('A'.repeat(64)).expect(400);
      await server()
        .post('/api/v1/password-reset')
        .send({ ...credentials, token: 'a'.repeat(63) })
        .expect(400);
      await server()
        .post('/api/v1/password-reset')
        .send({ ...credentials, token: 'a'.repeat(64), authPw: 'not hex' })
        .expect(400);
      await server()
        .post('/api/v1/password-reset')
        .send({ ...credentials, token: 'a'.repeat(64), clientSalt: 'a salt' })
        .expect(400);
    });

    it('lets only one of two resets racing on the same link through', async () => {
      const other = await signUpAccount(app, 'raced link password');
      const token = resetTokenOf((await createPasswordReset(app, adminToken, other.id).expect(201)).body.link);

      const results = await Promise.all([
        reset(token, 'first racing password'),
        reset(token, 'second racing password'),
      ]);

      expect(results.map(result => result.status).sort()).toEqual([200, 400]);
      expect(results.find(result => result.status === 400)?.body).toMatchObject(INVALID_LINK);
    });

    it('resets an account that never synced', async () => {
      const other = await signUpAccount(app, 'never synced password');
      const token = resetTokenOf((await createPasswordReset(app, adminToken, other.id).expect(201)).body.link);

      expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
      expect(await dbQuery(app, 'SELECT uid FROM tokenserver_user WHERE fxa_uid = ?', [other.uid])).toHaveLength(0);
    });

    it('raises the generation of every row, replaced ones included, on a later reset', async () => {
      const token = resetTokenOf((await createPasswordReset(app, adminToken, account.id).expect(201)).body.link);
      expect((await reset(token, 'a password after the second reset')).status).toBe(200);

      const [{ verifierSetAt }] = await dbQuery<{ verifierSetAt: number }>(
        app,
        'SELECT "verifierSetAt" FROM "user" WHERE id = ?',
        [account.id]
      );
      const rows = await dbQuery<{ generation: number; replaced_at: number | null }>(
        app,
        'SELECT generation, replaced_at FROM tokenserver_user WHERE fxa_uid = ?',
        [account.uid]
      );

      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every(row => row.generation >= verifierSetAt - 1 && row.replaced_at !== null)).toBe(true);
    });
  });
});
