import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';

import { UserRoleId } from '@libs/dto';

import { dbQuery } from '../utils/db';

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

export interface ITestUser {
  id: number;
  uid: string;
  email: string;
  name: string;
}

export interface ICreateTestUserOptions {
  roleIds?: UserRoleId[];
  enabled?: boolean;
  name?: string;
  uid?: string;
}

/**
 * Inserts an account directly, with random onepw values that no password matches, so fixtures skip the 650000-round
 * stretching. Sign in with `login()` from the user client, which opens a session the same way.
 */
export const createTestUser = async (
  app: NestExpressApplication,
  options: ICreateTestUserOptions = {}
): Promise<ITestUser> => {
  const { roleIds = [], enabled = true } = options;

  const email = `int-test-${randomUUID()}@foxden.test`;
  const name = options.name ?? email;
  const uid = options.uid ?? hex(16);
  const now = Date.now();

  const rows = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO "user" ("uid", "name", "email", "normalizedEmail", "locale", "authSalt", "verifyHash", "wrapWrapKb",
       "clientSalt", "kA", "verifierSetAt", "keysChangedAt", "enabled")
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      uid,
      name,
      email,
      email.toLowerCase(),
      hex(32),
      hex(32),
      hex(32),
      `identity.mozilla.com/picl/v1/quickStretchV2:${hex(16)}`,
      hex(32),
      now,
      now,
      enabled ? 1 : 0,
    ]
  );

  const id = rows[0].id;

  for (const roleId of roleIds) {
    await dbQuery(app, 'INSERT INTO "user_user_role" ("userId", "userRoleId") VALUES (?, ?)', [id, roleId]);
  }

  return { id, uid, email, name };
};
