import { MigrationInterface, QueryRunner } from 'typeorm';

import { UserRoleId } from '@libs/dto';

const USER_ROLES = [
  {
    id: UserRoleId.USER_ADMIN,
    name: 'User Admin',
  },
  {
    id: UserRoleId.SYSTEM_ADMIN,
    name: 'System Admin',
  },
];

export class AccountStructure1790815949423 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "uid" text NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL,
        "normalizedEmail" text NOT NULL,
        "locale" text,
        "authSalt" text NOT NULL,
        "verifyHash" text NOT NULL,
        "wrapWrapKb" text NOT NULL,
        "clientSalt" text NOT NULL,
        "kA" text NOT NULL,
        "verifierSetAt" integer NOT NULL,
        "keysChangedAt" integer NOT NULL,
        "enabled" boolean NOT NULL,
        "mustChangePassword" boolean NOT NULL DEFAULT (0),
        "lastLoginSuccess" datetime,
        "lastLoginFail" datetime,
        "lastAccess" datetime NOT NULL DEFAULT (datetime('now')),
        "createdDate" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_user_uid" UNIQUE ("uid"),
        CONSTRAINT "UQ_user_normalized_email" UNIQUE ("normalizedEmail")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "user_role" (
        "id" integer PRIMARY KEY NOT NULL,
        "name" text NOT NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "user_user_role" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "userRoleId" integer NOT NULL,
        CONSTRAINT "FK_user_user_role_user" FOREIGN KEY ("userId") REFERENCES "user" ("id"),
        CONSTRAINT "FK_user_user_role_user_role" FOREIGN KEY ("userRoleId") REFERENCES "user_role" ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenIdHash" text NOT NULL,
        "userId" integer NOT NULL,
        "userAgent" text,
        "createdAt" integer NOT NULL,
        "lastAccessAt" integer NOT NULL,
        "authAt" integer NOT NULL,
        CONSTRAINT "UQ_session_token_id_hash" UNIQUE ("tokenIdHash"),
        CONSTRAINT "FK_session_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "key_fetch_token" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenIdHash" text NOT NULL,
        "userId" integer NOT NULL,
        "bundle" text NOT NULL,
        "createdAt" integer NOT NULL,
        CONSTRAINT "UQ_key_fetch_token_token_id_hash" UNIQUE ("tokenIdHash"),
        CONSTRAINT "FK_key_fetch_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "password_change_token" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenIdHash" text NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" integer NOT NULL,
        CONSTRAINT "UQ_password_change_token_token_id_hash" UNIQUE ("tokenIdHash"),
        CONSTRAINT "FK_password_change_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "device" (
        "id" text PRIMARY KEY NOT NULL,
        "userId" integer NOT NULL,
        "sessionId" integer,
        "name" text NOT NULL,
        "type" text NOT NULL,
        "pushCallback" text,
        "pushPublicKey" text,
        "pushAuthKey" text,
        "pushEndpointExpired" boolean NOT NULL,
        "availableCommandsJson" text NOT NULL,
        "createdAt" integer NOT NULL,
        "lastAccessAt" integer NOT NULL,
        CONSTRAINT "UQ_device_session_id" UNIQUE ("sessionId"),
        CONSTRAINT "FK_device_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_device_session" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    for (const userRole of USER_ROLES) {
      await queryRunner.query('INSERT INTO user_role(id, name) VALUES (?, ?);', [userRole.id, userRole.name]);
    }
  }

  public async down(): Promise<void> {
    // Not required
  }
}
