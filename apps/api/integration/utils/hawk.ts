import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { SyncSecretService } from '@/core/tokenserver/sync-secret.service';

import { dbQuery } from './db';
import { ISyncToken, makeToken } from '@/core/tokenserver/sync-token';
import { hawkMac, hawkNormalizedString } from '@/firefox/storage/hawk';

// test.env's WEB_APP_BASE_URL, which Hawk signs against whatever Host header supertest sends.
const PUBLIC_HOST = 'localhost';
const PUBLIC_PORT = 8080;

export interface IStorageCredentials extends ISyncToken {
  uid: number;
  endpoint: string;
}

/** Signs like Firefox's `computeHAWK`: no payload hash, no ext. */
export function hawkAuthorization(
  credentials: ISyncToken,
  method: string,
  resource: string,
  ts = Math.floor(Date.now() / 1000)
): string {
  const nonce = randomBytes(8).toString('base64');
  const normalized = hawkNormalizedString({ ts, nonce, method, resource, host: PUBLIC_HOST, port: PUBLIC_PORT });
  const mac = hawkMac(credentials.key, normalized).toString('base64');

  return `Hawk id="${credentials.id}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
}

/** Seeds a tokenserver row for a fresh uid, as a token exchange would, and signs credentials for it. */
export async function mintStorageCredentials(
  app: NestExpressApplication,
  options: { expiresInSeconds?: number } = {}
): Promise<IStorageCredentials> {
  const [{ uid }] = await dbQuery<{ uid: number }>(
    app,
    'INSERT INTO tokenserver_user (fxa_uid, created_at) VALUES (?, ?) RETURNING uid',
    [randomBytes(16).toString('hex'), Date.now()]
  );

  return signStorageCredentials(app, uid, options.expiresInSeconds);
}

export function signStorageCredentials(
  app: NestExpressApplication,
  uid: number,
  expiresInSeconds = 3600
): IStorageCredentials {
  const token = makeToken(
    {
      node: 'http://localhost:8080/storage',
      fxa_kid: '',
      fxa_uid: '',
      hashed_device_id: '',
      hashed_fxa_uid: '',
      expires: Math.floor(Date.now() / 1000) + expiresInSeconds,
      uid,
      tokenserver_origin: 'rust',
    },
    app.get(SyncSecretService).masterSecret
  );

  return { ...token, uid, endpoint: `/storage/1.5/${uid}` };
}

/** The credentials a token exchange answered with. */
export const syncTokenCredentials = (
  body: ISyncToken & { uid: number; api_endpoint: string }
): IStorageCredentials => ({
  id: body.id,
  key: body.key,
  uid: body.uid,
  endpoint: new URL(body.api_endpoint).pathname,
});

type Method = 'get' | 'put' | 'post' | 'delete' | 'patch';

/** A Hawk-signed request to a path under the credentials' endpoint, such as `/storage/bookmarks?full=1`. */
export function storageRequest(
  app: NestExpressApplication,
  credentials: IStorageCredentials,
  method: Method,
  path: string
): request.Test {
  const resource = `${credentials.endpoint}${path}`;

  return request(app.getHttpServer())
    [method](resource)
    .set('Authorization', hawkAuthorization(credentials, method.toUpperCase(), resource));
}
