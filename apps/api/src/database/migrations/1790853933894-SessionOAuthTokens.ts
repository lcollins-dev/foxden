import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ties every authorization code, refresh token and access token to the session that obtained it. Deletes every
 * existing one, which has no session to take.
 */
export class SessionOAuthTokens1790853933894 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "authorization_code"`);
    await queryRunner.query(`DROP TABLE "refresh_token"`);
    await queryRunner.query(`DROP TABLE "access_token"`);

    await queryRunner.query(`
      CREATE TABLE "authorization_code" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "codeHash" text NOT NULL,
        "userId" integer NOT NULL,
        "sessionId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "keysJwe" text,
        "codeChallenge" text NOT NULL,
        "offline" boolean NOT NULL,
        "authAt" integer NOT NULL,
        "createdAt" integer NOT NULL,
        CONSTRAINT "UQ_authorization_code_code_hash" UNIQUE ("codeHash"),
        CONSTRAINT "FK_authorization_code_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_authorization_code_session" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_authorization_code_session_id" ON "authorization_code" ("sessionId")`);

    await queryRunner.query(`
      CREATE TABLE "refresh_token" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenHash" text NOT NULL,
        "userId" integer NOT NULL,
        "sessionId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "createdAt" integer NOT NULL,
        "lastUsedAt" integer NOT NULL,
        CONSTRAINT "UQ_refresh_token_token_hash" UNIQUE ("tokenHash"),
        CONSTRAINT "UQ_refresh_token_session_id" UNIQUE ("sessionId"),
        CONSTRAINT "FK_refresh_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_refresh_token_session" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "access_token" (
        "jti" text PRIMARY KEY NOT NULL,
        "userId" integer NOT NULL,
        "sessionId" integer NOT NULL,
        "clientId" text NOT NULL,
        "scope" text NOT NULL,
        "expiresAt" integer NOT NULL,
        CONSTRAINT "FK_access_token_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_access_token_session" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_access_token_session_id" ON "access_token" ("sessionId")`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
