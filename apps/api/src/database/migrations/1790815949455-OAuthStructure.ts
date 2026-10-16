import { MigrationInterface, QueryRunner } from 'typeorm';

export class OAuthStructure1790815949455 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "authorization_code" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "codeHash" text NOT NULL,
        "userId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "keysJwe" text,
        "codeChallenge" text NOT NULL,
        "offline" boolean NOT NULL,
        "authAt" integer NOT NULL,
        "createdAt" integer NOT NULL,
        CONSTRAINT "UQ_authorization_code_code_hash" UNIQUE ("codeHash"),
        CONSTRAINT "FK_authorization_code_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_token" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenHash" text NOT NULL,
        "userId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "createdAt" integer NOT NULL,
        "lastUsedAt" integer NOT NULL,
        CONSTRAINT "UQ_refresh_token_token_hash" UNIQUE ("tokenHash"),
        CONSTRAINT "FK_refresh_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "access_token" (
        "jti" text PRIMARY KEY NOT NULL,
        "userId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "expiresAt" integer NOT NULL,
        CONSTRAINT "FK_access_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "signing_key" (
        "kid" text PRIMARY KEY NOT NULL,
        "privateJwkJson" text NOT NULL,
        "createdAt" integer NOT NULL
      );
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
