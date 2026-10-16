import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';
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
import { dbQuery } from '../../utils/db';

const FIREFOX_CLIENT_ID = '5882386c6d801776';
const PASSWORD = 'the password to replace';
const NEW_PASSWORD = 'the password chosen at setup';

// A test instance has the seeded admin and so never creates the default admin; these specs flag an admin of their own.
describe('First-time setup enforcement (integration)', () => {
  let app: NestExpressApplication;
  let account: ISignedUpAccount;
  let apiToken: string;
  let keysChangedAt: number;
  let setupKb: string;

  const server = () => request(app.getHttpServer());
  const api = () => ({ Authorization: apiToken });

  const authPw = async (password: string): Promise<string> =>
    bytesToHex((await stretchPasswordV2(password, account.clientSalt)).authPW);

  const fetchKb = async (keyFetchToken: string, password: string): Promise<string> => {
    const stretched = await stretchPasswordV2(password, account.clientSalt);
    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(keyFetchToken))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(keyFetchToken, keys.body.bundle);

    return bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey));
  };

  const readKeysChangedAt = async (): Promise<number> => {
    const [user] = await dbQuery<{ keysChangedAt: number }>(app, 'SELECT "keysChangedAt" FROM "user" WHERE id = ?', [
      account.id,
    ]);

    return user.keysChangedAt;
  };

  beforeAll(async () => {
    app = await bootstrapApp();
    account = await signUpAccount(app, PASSWORD);
    keysChangedAt = await readKeysChangedAt();

    for (const roleId of [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]) {
      await dbQuery(app, 'INSERT INTO "user_user_role" ("userId", "userRoleId") VALUES (?, ?)', [account.id, roleId]);
    }

    await dbQuery(app, 'UPDATE "user" SET "mustChangePassword" = 1 WHERE id = ?', [account.id]);

    const { tokenId } = await deriveTokenKeys(account.sessionToken, 'sessionToken');
    apiToken = `Bearer fxs_${tokenId}`;
  });

  it('leaves the seeded test admin alone, so no default admin exists on a test instance', async () => {
    const rows = await dbQuery(app, 'SELECT id FROM "user" WHERE "normalizedEmail" = ?', [DEFAULT_ADMIN.email]);

    expect(rows).toHaveLength(0);
  });

  it('serves the profile with the flag set', async () => {
    const response = await server().get('/api/v1/user/profile').set(api()).expect(200);

    expect(response.body).toMatchObject({ email: account.email, mustChangePassword: true });
  });

  it('refuses every other /api/v1 route, admin roles notwithstanding', async () => {
    const refusals = [
      () => server().patch('/api/v1/user/profile').set(api()).send({ name: 'New Name' }),
      () => server().get('/api/v1/admin/user/stats').set(api()),
      () =>
        server()
          .post('/api/v1/admin/invite')
          .set(api())
          .send({ email: 'someone@foxden.test', name: 'Someone', admin: false }),
      () => server().get('/api/v1/user/session/list').set(api()),
    ];

    for (const refusal of refusals) {
      const response = await refusal().expect(403);

      expect(response.body.message).toBe('Change the default password before doing anything else');
    }
  });

  it('refuses the Firefox sign-in with errno 250 once the password matches, and lets the web app sign in', async () => {
    const wrong = await server()
      .post('/auth/v1/account/login')
      .send({ email: account.email, authPW: await authPw('not the password'), service: 'sync' })
      .expect(400);
    expect(wrong.body.errno).toBe(103);

    const firefox = await server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: account.email, authPW: await authPw(PASSWORD), service: 'sync' })
      .expect(400);
    expect(firefox.body).toMatchObject({ errno: 250 });
    expect(firefox.body.message).toMatch(/web app/);

    await server()
      .post('/auth/v1/account/login')
      .send({ email: account.email, authPW: await authPw(PASSWORD) })
      .expect(200);
  });

  it('hands the web app sign-in only the kB from before setup', async () => {
    const login = await server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: account.email, authPW: await authPw(PASSWORD) })
      .expect(200);

    expect(await fetchKb(login.body.keyFetchTokenVersion2, PASSWORD)).toBe(bytesToHex(account.kB));
  });

  it('gives a session held to setup no scoped keys, authorization code or access token', async () => {
    const bearer = await sessionTokenBearer(account.sessionToken);

    const keyData = await server()
      .post('/auth/v1/account/scoped-key-data')
      .set('Authorization', bearer)
      .send({ client_id: FIREFOX_CLIENT_ID, scope: OLDSYNC_SCOPE })
      .expect(400);
    expect(keyData.body.errno).toBe(250);

    const authorization = await server()
      .post('/auth/v1/oauth/authorization')
      .set('Authorization', bearer)
      .send({
        client_id: FIREFOX_CLIENT_ID,
        state: 'state',
        scope: OLDSYNC_SCOPE,
        response_type: 'code',
        code_challenge: await codeChallengeS256(createCodeVerifier()),
        code_challenge_method: 'S256',
      })
      .expect(400);
    expect(authorization.body.errno).toBe(250);

    const token = await server()
      .post('/auth/v1/oauth/token')
      .set('Authorization', bearer)
      .send({ client_id: FIREFOX_CLIENT_ID, grant_type: 'fxa-credentials', scope: OLDSYNC_SCOPE })
      .expect(400);
    expect(token.body.errno).toBe(250);
  });

  it('lets the setup screen change the address with proof of the current password', async () => {
    const newEmail = `Setup-${Date.now()}@Foxden.test`;

    const wrong = await server()
      .post('/api/v1/user/email')
      .set(api())
      .send({ email: newEmail, authPw: await authPw('not the password') })
      .expect(400);
    expect(wrong.body.message).toEqual([
      expect.objectContaining({ path: 'authPw', message: "That isn't your current password." }),
    ]);

    await server()
      .post('/api/v1/user/email')
      .set(api())
      .send({ email: newEmail, authPw: await authPw(PASSWORD) })
      .expect(200);

    const profile = await server().get('/api/v1/user/profile').set(api()).expect(200);
    expect(profile.body).toMatchObject({ email: newEmail, mustChangePassword: true });

    account = { ...account, email: newEmail };
  });

  it('clears the flag with a password change, after which everything is open', async () => {
    const old = await stretchPasswordV2(PASSWORD, account.clientSalt);
    const started = await server()
      .post('/auth/v1/password/change/start')
      .set('Authorization', await sessionTokenBearer(account.sessionToken))
      .send({ email: account.email, oldAuthPW: bytesToHex(old.authPW) })
      .expect(200);

    const kB = await fetchKb(started.body.keyFetchToken2, PASSWORD);
    expect(kB).toBe(bytesToHex(account.kB));

    const next = await stretchPasswordV2(NEW_PASSWORD, account.clientSalt);
    const { tokenId } = await deriveTokenKeys(account.sessionToken, 'sessionToken');

    const finished = await server()
      .post('/auth/v1/password/change/finish?keys=true')
      .set('Authorization', await passwordChangeTokenBearer(started.body.passwordChangeToken))
      .send({
        authPWVersion2: bytesToHex(next.authPW),
        wrapKbVersion2: bytesToHex(xorBytes(account.kB, next.unwrapBKey)),
        clientSalt: account.clientSalt,
        sessionToken: tokenId,
      })
      .expect(200);

    const newTokenId = (await deriveTokenKeys(finished.body.sessionToken, 'sessionToken')).tokenId;
    apiToken = `Bearer fxs_${newTokenId}`;
    setupKb = await fetchKb(finished.body.keyFetchToken2, NEW_PASSWORD);

    const profile = await server().get('/api/v1/user/profile').set(api()).expect(200);
    expect(profile.body.mustChangePassword).toBe(false);

    await server().get('/api/v1/admin/user/stats').set(api()).expect(200);

    await server()
      .post('/auth/v1/account/login')
      .send({ email: account.email, authPW: bytesToHex(next.authPW), service: 'sync' })
      .expect(200);
  });

  it('re-keys at setup, so no kB fetched while held to setup unwraps anything afterwards', async () => {
    expect(setupKb).toMatch(/^[0-9a-f]{64}$/);
    expect(setupKb).not.toBe(bytesToHex(account.kB));
    expect(await readKeysChangedAt()).toBeGreaterThan(keysChangedAt);

    const login = await server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: account.email, authPW: await authPw(NEW_PASSWORD), service: 'sync' })
      .expect(200);

    expect(await fetchKb(login.body.keyFetchTokenVersion2, NEW_PASSWORD)).toBe(setupKb);
  });

  it('signs out while held to setup', async () => {
    const other = await signUpAccount(app, PASSWORD);
    await dbQuery(app, 'UPDATE "user" SET "mustChangePassword" = 1 WHERE id = ?', [other.id]);

    const bearer = `Bearer fxs_${(await deriveTokenKeys(other.sessionToken, 'sessionToken')).tokenId}`;

    await server().post('/api/v1/user/logout').set('Authorization', bearer).expect(201);
    await server().get('/api/v1/user/profile').set('Authorization', bearer).expect(401);
  });
});

describe('Email change (integration)', () => {
  let app: NestExpressApplication;
  let account: ISignedUpAccount;
  let apiToken: string;

  const server = () => request(app.getHttpServer());

  const authPw = async (password: string): Promise<string> =>
    bytesToHex((await stretchPasswordV2(password, account.clientSalt)).authPW);

  beforeAll(async () => {
    app = await bootstrapApp();
    account = await signUpAccount(app, PASSWORD);
    apiToken = `Bearer fxs_${(await deriveTokenKeys(account.sessionToken, 'sessionToken')).tokenId}`;
  });

  it('refuses an address another account uses, in any case', async () => {
    const other = await signUpAccount(app, PASSWORD);

    const response = await server()
      .post('/api/v1/user/email')
      .set('Authorization', apiToken)
      .send({ email: other.email.toUpperCase(), authPw: await authPw(PASSWORD) })
      .expect(400);

    expect(response.body.message).toEqual([
      expect.objectContaining({
        path: 'email',
        message: 'Another account already uses this email.',
      }),
    ]);
  });

  it('moves sign-in to the new address with the same password and kB, keeping the session', async () => {
    const newEmail = `moved-${Date.now()}@foxden.test`;

    await server()
      .post('/api/v1/user/email')
      .set('Authorization', apiToken)
      .send({ email: newEmail, authPw: await authPw(PASSWORD) })
      .expect(200);

    const unknown = await server().post('/auth/v1/account/status').send({ email: account.email }).expect(200);
    expect(unknown.body.exists).toBe(false);

    const stretched = await stretchPasswordV2(PASSWORD, account.clientSalt);
    const login = await server()
      .post('/auth/v1/account/login?keys=true')
      .send({ email: newEmail, authPW: bytesToHex(stretched.authPW) })
      .expect(200);

    const keys = await server()
      .get('/auth/v1/account/keys')
      .set('Authorization', await keyFetchTokenBearer(login.body.keyFetchTokenVersion2))
      .expect(200);
    const bundle = await unbundleKeyFetchResponse(login.body.keyFetchTokenVersion2, keys.body.bundle);
    expect(bytesToHex(unwrapKb(bundle.wrapKb, stretched.unwrapBKey))).toBe(bytesToHex(account.kB));

    await server().get('/api/v1/user/profile').set('Authorization', apiToken).expect(200);
  });

  it('rejects a malformed proof', async () => {
    await server()
      .post('/api/v1/user/email')
      .set('Authorization', apiToken)
      .send({ email: 'x@foxden.test', authPw: 'not hex' })
      .expect(400);
  });
});
