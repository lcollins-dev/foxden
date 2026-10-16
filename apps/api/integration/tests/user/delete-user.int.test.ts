import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { deleteUser, getProfile, getUser, login } from '../../clients/user.client';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { keyIdHeader, signAccessToken } from '../../utils/access-token';
import { dbQuery } from '../../utils/db';
import { IStorageCredentials, storageRequest, syncTokenCredentials } from '../../utils/hawk';

const TOKEN_PATH = '/token/1.0/sync/1.5';
const CLIENT_STATE = 'aaaa';
const KEYS_CHANGED_AT = 1234;

describe('Deleting an account (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  const accessTokenFor = async (user: ITestUser, claims: Record<string, unknown> = {}): Promise<string> => {
    const [row] = await dbQuery<{ verifierSetAt: number }>(app, 'SELECT "verifierSetAt" FROM "user" WHERE id = ?', [
      user.id,
    ]);

    return signAccessToken(app, { sub: user.uid, 'fxa-generation': row.verifierSetAt, ...claims });
  };

  const exchange = (accessToken: string) =>
    request(app.getHttpServer())
      .get(TOKEN_PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-KeyID', keyIdHeader(KEYS_CHANGED_AT, CLIENT_STATE));

  const putBso = (credentials: IStorageCredentials) =>
    storageRequest(app, credentials, 'put', '/storage/bookmarks/b1')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ payload: 'encrypted' }));

  const startSyncing = async (accessToken: string): Promise<IStorageCredentials> => {
    const credentials = syncTokenCredentials((await exchange(accessToken).expect(200)).body);

    await putBso(credentials).expect(200);

    return credentials;
  };

  const storageRows = async (uid: number): Promise<number> => {
    let rows = 0;

    for (const table of ['storage_bso', 'storage_collection', 'storage_user']) {
      rows += (await dbQuery(app, `SELECT uid FROM ${table} WHERE uid = ?`, [uid])).length;
    }

    return rows;
  };

  it('deletes the account and everything hanging off it, and wipes its Sync storage', async () => {
    const user = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    const userToken = await login(app, user.email);
    const accessToken = await accessTokenFor(user);
    const { uid } = await startSyncing(accessToken);

    expect(await storageRows(uid)).toBeGreaterThan(0);

    await deleteUser(app, token, user.id).expect(200);

    await getUser(app, token, user.id).expect(400);
    await getProfile(app, userToken).expect(401);
    expect(await storageRows(uid)).toBe(0);

    for (const table of ['session', 'user_user_role', 'access_token', 'refresh_token']) {
      expect(await dbQuery(app, `SELECT "userId" FROM ${table} WHERE "userId" = ?`, [user.id])).toEqual([]);
    }
  });

  it('refuses a token exchange with an access token minted before the deletion, whose record went with the account, keeping its rows as tombstones', async () => {
    const user = await createTestUser(app);
    const accessToken = await accessTokenFor(user);
    const withoutGeneration = await signAccessToken(app, { sub: user.uid });
    const { uid } = await startSyncing(accessToken);

    await deleteUser(app, token, user.id).expect(200);

    for (const refused of [accessToken, withoutGeneration]) {
      const response = await exchange(refused).expect(401);

      expect(response.body).toEqual({
        status: 'invalid-credentials',
        errors: [{ location: 'body', name: '', description: 'Unauthorized' }],
      });
    }

    expect(await storageRows(uid)).toBe(0);
    expect(await dbQuery(app, 'SELECT uid, generation FROM tokenserver_user WHERE fxa_uid = ?', [user.uid])).toEqual([
      { uid, generation: Number.MAX_SAFE_INTEGER },
    ]);
  });

  it('refuses a storage token issued before the deletion, leaving nothing behind', async () => {
    const user = await createTestUser(app);
    const credentials = await startSyncing(await accessTokenFor(user));

    await deleteUser(app, token, user.id).expect(200);

    await putBso(credentials).expect(401);
    expect(await storageRows(credentials.uid)).toBe(0);
  });

  it('refuses a token exchange for an account deleted before it ever synced', async () => {
    const user = await createTestUser(app);
    const accessToken = await accessTokenFor(user);

    await deleteUser(app, token, user.id).expect(200);

    await exchange(accessToken).expect(401);
    expect(await dbQuery(app, 'SELECT uid FROM tokenserver_user WHERE fxa_uid = ?', [user.uid])).toHaveLength(1);
  });

  it('rejects a user id that does not exist', async () => {
    await deleteUser(app, token, 2147483647).expect(400);
  });

  it('is refused to an account without the user-admin role', async () => {
    const user = await createTestUser(app);
    const target = await createTestUser(app);

    await deleteUser(app, await login(app, user.email), target.id).expect(401);
    await getUser(app, token, target.id).expect(200);
  });
});
