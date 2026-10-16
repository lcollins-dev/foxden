import { randomBytes } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

import { UserRoleId } from '@libs/dto';

import { clientSignUp } from '@/core/user/client-sign-up';
import { createCredentials } from '@/core/user/onepw';

/** Signs in the e2e suites; e2e/utils/users.ts and firefox-e2e/src/server.ts hold the same values. */
export const TEST_ADMIN = {
  email: 'admin@foxden.test',
  password: 'TestPass123!',
};

export class TestAdmin9000000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = await clientSignUp(TEST_ADMIN.password);
    const credentials = await createCredentials(values.authPw, values.wrapKb, values.clientSalt);
    const now = Date.now();

    const rows: unknown = await queryRunner.query(
      `INSERT INTO "user" ("uid", "name", "email", "normalizedEmail", "locale", "authSalt", "verifyHash", "wrapWrapKb",
         "clientSalt", "kA", "verifierSetAt", "keysChangedAt", "enabled")
       VALUES (?, 'Test Admin', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1)
       RETURNING id`,
      [
        randomBytes(16).toString('hex'),
        TEST_ADMIN.email,
        TEST_ADMIN.email,
        credentials.authSalt,
        credentials.verifyHash,
        credentials.wrapWrapKb,
        credentials.clientSalt,
        randomBytes(32).toString('hex'),
        now,
        now,
      ]
    );

    const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const userId = typeof first === 'object' && first !== null && 'id' in first ? first.id : undefined;

    if (typeof userId !== 'number') {
      throw new Error('Inserting the test admin returned no id');
    }

    for (const roleId of [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]) {
      await queryRunner.query('INSERT INTO "user_user_role" ("userId", "userRoleId") VALUES (?, ?)', [userId, roleId]);
    }
  }

  public async down(): Promise<void> {
    // Not required
  }
}
