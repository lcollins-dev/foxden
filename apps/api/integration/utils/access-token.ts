import { NestExpressApplication } from '@nestjs/platform-express';
import { JWTPayload, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';

import { IActiveSigningKey } from '@/core/oauth/signing-key.service';

import { createTestUser } from '../factories/user.factory';
import { dbQuery } from './db';

export const SYNC_SCOPE = 'https://identity.mozilla.com/apps/oldsync';

/** The tokenserver trusts only the app's own signing key, so test tokens are signed with it. */
let appSigningKey: IActiveSigningKey | undefined;

export const useAppSigningKey = (signingKey: IActiveSigningKey): void => {
  appSigningKey = signingKey;
};

const activeSigningKey = (): IActiveSigningKey => {
  if (appSigningKey === undefined) {
    throw new Error('No signing key yet - bootstrap the app first');
  }

  return appSigningKey;
};

export interface ISignOptions {
  typ?: string;
  expiresInSeconds?: number;
  signingKey?: CryptoKey | Uint8Array;
  /** Records the token for this account instead of the one `sub` names. */
  recordFor?: string;
}

/** Creates the account `sub` names when there is none, and a fresh session to hold the record. */
const recordAccessToken = async (
  app: NestExpressApplication,
  jti: string,
  sub: string,
  expiresInSeconds: number
): Promise<void> => {
  const existing = await dbQuery<{ id: number }>(app, 'SELECT id FROM "user" WHERE uid = ?', [sub]);
  const userId = existing.length > 0 ? existing[0].id : (await createTestUser(app, { uid: sub })).id;
  const now = Date.now();

  const [session] = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO "session" ("tokenIdHash", "userId", "userAgent", "createdAt", "lastAccessAt", "authAt")
     VALUES (?, ?, NULL, ?, ?, ?)
     RETURNING id`,
    [randomBytes(32).toString('hex'), userId, now, now, now]
  );

  await dbQuery(
    app,
    `INSERT INTO "access_token" ("jti", "userId", "sessionId", "clientId", "scope", "expiresAt")
     VALUES (?, ?, ?, '5882386c6d801776', ?, ?)`,
    [jti, userId, session.id, SYNC_SCOPE, now + expiresInSeconds * 1000]
  );
};

/** Writes the token's record as minting does, since the tokenserver refuses a token without one. */
export async function signAccessToken(
  app: NestExpressApplication,
  claims: JWTPayload & { sub: string },
  options: ISignOptions = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomBytes(32).toString('hex');
  const expiresInSeconds = options.expiresInSeconds ?? 3600;

  await recordAccessToken(app, jti, options.recordFor ?? claims.sub, expiresInSeconds);

  return new SignJWT({ scope: SYNC_SCOPE, jti, ...claims })
    .setProtectedHeader({ alg: 'RS256', typ: options.typ ?? 'at+JWT', kid: activeSigningKey().kid })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(options.signingKey ?? activeSigningKey().privateKey);
}

export const keyIdHeader = (keysChangedAt: number, clientStateHex: string): string =>
  `${keysChangedAt}-${Buffer.from(clientStateHex, 'hex').toString('base64url')}`;
