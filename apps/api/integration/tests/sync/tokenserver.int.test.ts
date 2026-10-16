import { NestExpressApplication } from '@nestjs/platform-express';
import { generateKeyPair } from 'jose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';
import { keyIdHeader, signAccessToken } from '../../utils/access-token';
import { dbQuery } from '../../utils/db';
import { hawkAuthorization, storageRequest, syncTokenCredentials } from '../../utils/hawk';

const TOKEN_PATH = '/token/1.0/sync/1.5';

const CLIENT_STATE_A = 'aaaa';
const CLIENT_STATE_B = 'bbbb';

const newFxaUid = (): string => randomBytes(16).toString('hex');

const decodeTokenPayload = (id: string): Record<string, unknown> => {
  const decoded = Buffer.from(id, 'base64url');

  return JSON.parse(decoded.subarray(0, decoded.length - 32).toString('utf8'));
};

describe('Tokenserver (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  const tokenRequest = async (
    fxaUid: string,
    keyId: string | null,
    status: number,
    claims: Record<string, unknown> = {}
  ): Promise<request.Response> => {
    const accessToken = await signAccessToken(app, { sub: fxaUid, ...claims });
    const pending = request(app.getHttpServer()).get(TOKEN_PATH).set('Authorization', `Bearer ${accessToken}`);

    return (keyId === null ? pending : pending.set('X-KeyID', keyId)).expect(status);
  };

  const expectError = (body: unknown, status: string, description: string, location = 'body', name = '') => {
    expect(body).toEqual({ status, errors: [{ location, name, description }] });
  };

  describe('issuing a token', () => {
    it('answers with Hawk credentials for a storage endpoint under the public base URL', async () => {
      const fxaUid = newFxaUid();
      const response = await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-timestamp']).toMatch(/^[0-9]+$/);

      expect(response.body).toEqual({
        id: expect.any(String),
        key: expect.any(String),
        uid: expect.any(Number),
        api_endpoint: `http://localhost:8080/storage/1.5/${response.body.uid}`,
        duration: 3600,
        hashed_fxa_uid: expect.stringMatching(/^[0-9a-f]{32}$/),
        hashalg: 'sha256',
        node_type: 'sqlite',
      });

      // test_e2e.py: client state aaaa arrives as `1234-qqo` and goes into the token as a 13-digit kid.
      expect(decodeTokenPayload(response.body.id)).toMatchObject({
        fxa_uid: fxaUid,
        fxa_kid: '0000000001234-qqo',
        uid: response.body.uid,
        node: 'http://localhost:8080/storage',
        hashed_fxa_uid: response.body.hashed_fxa_uid,
        tokenserver_origin: 'rust',
      });
    });

    it('issues credentials the storage endpoint accepts', async () => {
      const token = (await tokenRequest(newFxaUid(), keyIdHeader(1234, CLIENT_STATE_A), 200)).body;
      const path = new URL(token.api_endpoint).pathname + '/info/collections';

      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', hawkAuthorization(token, 'GET', path))
        .expect(200);

      expect(response.body).toEqual({});
    });

    it('keeps the uid while the keys stay the same', async () => {
      const fxaUid = newFxaUid();
      const first = await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200);
      const second = await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200);

      expect(second.body.uid).toBe(first.body.uid);
      expect(second.body.hashed_fxa_uid).toBe(first.body.hashed_fxa_uid);
    });

    it('shortens the token life to a requested duration, never lengthens it', async () => {
      const fxaUid = newFxaUid();
      const accessToken = await signAccessToken(app, { sub: fxaUid });

      for (const [duration, expected] of [
        ['12', 12],
        ['4000', 3600],
        ['lolwut', 3600],
        ['-1', 3600],
      ] as const) {
        const response = await request(app.getHttpServer())
          .get(`${TOKEN_PATH}?duration=${duration}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
          .expect(200);

        expect(response.body.duration).toBe(expected);
      }
    });
  });

  describe('client state changes', () => {
    it("allocates a new uid, wipes the old uid's storage and refuses its storage token when the client state changes", async () => {
      const fxaUid = newFxaUid();
      const old = (await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200)).body;
      const bsoPath = `${new URL(old.api_endpoint).pathname}/storage/meta/global`;

      await request(app.getHttpServer())
        .put(bsoPath)
        .set('Authorization', hawkAuthorization(old, 'PUT', bsoPath))
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify({ payload: 'meta' }))
        .expect(200);

      expect(await dbQuery(app, 'SELECT id FROM storage_bso WHERE uid = ?', [old.uid])).toHaveLength(1);

      const next = (await tokenRequest(fxaUid, keyIdHeader(2345, CLIENT_STATE_B), 200)).body;

      expect(next.uid).not.toBe(old.uid);
      expect(decodeTokenPayload(next.id).fxa_kid).toBe('0000000002345-u7s');
      expect(await dbQuery(app, 'SELECT id FROM storage_bso WHERE uid = ?', [old.uid])).toHaveLength(0);
      expect(await dbQuery(app, 'SELECT uid FROM storage_user WHERE uid = ?', [old.uid])).toHaveLength(0);

      const rows = await dbQuery<{ uid: number; replaced_at: number | null; generation: number }>(
        app,
        'SELECT uid, replaced_at, generation FROM tokenserver_user WHERE fxa_uid = ? ORDER BY uid',
        [fxaUid]
      );

      expect(rows).toEqual([
        { uid: old.uid, replaced_at: expect.any(Number), generation: 0 },
        // Without a generation claim, the raised keys_changed_at stands in for one (test_update_client_state).
        { uid: next.uid, replaced_at: null, generation: 2345 },
      ]);

      const putMeta = (token: typeof old) =>
        storageRequest(app, syncTokenCredentials(token), 'put', '/storage/meta/global')
          .set('Content-Type', 'text/plain')
          .send(JSON.stringify({ payload: 'meta' }));

      await putMeta(old).expect(401);
      expect(await dbQuery(app, 'SELECT uid FROM storage_user WHERE uid = ?', [old.uid])).toHaveLength(0);
      await putMeta(next).expect(200);
    });

    it('rejects a device that still presents the old client state', async () => {
      const fxaUid = newFxaUid();

      await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200);
      await tokenRequest(fxaUid, keyIdHeader(2345, CLIENT_STATE_B), 200);

      const response = await tokenRequest(fxaUid, keyIdHeader(3456, CLIENT_STATE_A), 401);

      expectError(
        response.body,
        'invalid-client-state',
        'Unacceptable client-state value stale value',
        'header',
        'X-Client-State'
      );
    });

    it('rejects a new client state without a keys_changed_at change', async () => {
      const fxaUid = newFxaUid();

      await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200);

      const response = await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_B), 401);

      expectError(
        response.body,
        'invalid-client-state',
        'Unacceptable client-state value new value with no keys_changed_at change',
        'header',
        'X-Client-State'
      );
    });

    it('rejects a generation lower than one already seen', async () => {
      const fxaUid = newFxaUid();

      await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 200, { 'fxa-generation': 2000 });

      const response = await tokenRequest(fxaUid, keyIdHeader(1234, CLIENT_STATE_A), 401, {
        'fxa-generation': 1500,
      });

      expectError(response.body, 'invalid-generation', 'Unauthorized');
    });

    it('rejects a keys_changed_at lower than one already seen', async () => {
      const fxaUid = newFxaUid();

      await tokenRequest(fxaUid, keyIdHeader(2000, CLIENT_STATE_A), 200);

      const response = await tokenRequest(fxaUid, keyIdHeader(1500, CLIENT_STATE_A), 401);

      expectError(response.body, 'invalid-keysChangedAt', 'Unauthorized');
    });
  });

  describe('rejecting a request', () => {
    it('answers a missing Authorization header with 401', async () => {
      const response = await request(app.getHttpServer()).get(TOKEN_PATH).expect(401);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expectError(response.body, 'error', 'Unauthorized');
    });

    it('answers a scheme other than Bearer with Unsupported', async () => {
      const response = await request(app.getHttpServer())
        .get(TOKEN_PATH)
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);

      expectError(response.body, 'error', 'Unsupported');
    });

    it('answers an opaque token with invalid-credentials', async () => {
      const response = await request(app.getHttpServer())
        .get(TOKEN_PATH)
        .set('Authorization', `Bearer ${randomBytes(32).toString('hex')}`)
        .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
        .expect(401);

      expectError(response.body, 'invalid-credentials', 'Unauthorized');
    });

    it('answers an expired, mistyped, unscoped or foreign-signed token with invalid-credentials', async () => {
      const foreignKey = (await generateKeyPair('RS256')).privateKey;
      const tokens = [
        await signAccessToken(app, { sub: newFxaUid() }, { expiresInSeconds: -120 }),
        await signAccessToken(app, { sub: newFxaUid() }, { typ: 'JWT' }),
        await signAccessToken(app, { sub: newFxaUid(), scope: 'profile' }),
        await signAccessToken(app, { sub: newFxaUid() }, { signingKey: foreignKey }),
      ];

      for (const token of tokens) {
        const response = await request(app.getHttpServer())
          .get(TOKEN_PATH)
          .set('Authorization', `Bearer ${token}`)
          .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
          .expect(401);

        expectError(response.body, 'invalid-credentials', 'Unauthorized');
      }
    });

    it('answers a token recorded for another account, or for a disabled one, with invalid-credentials', async () => {
      const disabledUid = newFxaUid();
      const tokens = [
        await signAccessToken(app, { sub: newFxaUid() }, { recordFor: newFxaUid() }),
        await signAccessToken(app, { sub: disabledUid }),
      ];
      await dbQuery(app, 'UPDATE "user" SET enabled = 0 WHERE uid = ?', [disabledUid]);

      for (const token of tokens) {
        const response = await request(app.getHttpServer())
          .get(TOKEN_PATH)
          .set('Authorization', `Bearer ${token}`)
          .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
          .expect(401);

        expectError(response.body, 'invalid-credentials', 'Unauthorized');
      }
    });

    it('accepts the oldsync scope among others, split by spaces or commas', async () => {
      for (const scope of [
        'profile https://identity.mozilla.com/apps/oldsync',
        'profile,https://identity.mozilla.com/apps/oldsync',
      ]) {
        await tokenRequest(newFxaUid(), keyIdHeader(1234, CLIENT_STATE_A), 200, { scope });
      }
    });

    it('answers a missing X-KeyID with invalid-key-id', async () => {
      const response = await tokenRequest(newFxaUid(), null, 401);

      expectError(response.body, 'invalid-key-id', 'Missing X-KeyID header', 'header');
    });

    it('answers a malformed X-KeyID with invalid-credentials', async () => {
      for (const keyId of ['1234', '1234-qqo=', 'abc-qqo']) {
        const response = await tokenRequest(newFxaUid(), keyId, 401);

        expectError(response.body, 'invalid-credentials', 'Unauthorized');
      }
    });

    it('checks a legacy X-Client-State against the X-KeyID', async () => {
      const accessToken = await signAccessToken(app, { sub: newFxaUid() });
      const send = (clientState: string) =>
        request(app.getHttpServer())
          .get(TOKEN_PATH)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
          .set('X-Client-State', clientState);

      expectError((await send('bbbb').expect(401)).body, 'invalid-client-state', 'Unauthorized');
      expectError(
        (await send('not a state!').expect(400)).body,
        'error',
        'Invalid client state value',
        'header',
        'X-Client-State'
      );
      await send(CLIENT_STATE_A).expect(200);
    });

    it('answers an unknown application or version with 404', async () => {
      const accessToken = await signAccessToken(app, { sub: newFxaUid() });
      const send = (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-KeyID', keyIdHeader(1234, CLIENT_STATE_A))
          .expect(404);

      expectError((await send('/token/1.0/xxx/1.5')).body, 'error', 'Unsupported application', 'url', 'application');
      expectError((await send('/token/1.0/sync/1.0')).body, 'error', 'Unsupported application version', 'url', '1.0');
    });
  });
});
