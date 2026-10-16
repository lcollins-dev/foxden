import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordResetStructure1790968555553 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenHash" text NOT NULL,
        "userId" integer NOT NULL,
        "expiresAt" integer NOT NULL,
        "createdAt" integer NOT NULL,
        "usedAt" integer,
        CONSTRAINT "UQ_password_reset_token_hash" UNIQUE ("tokenHash"),
        CONSTRAINT "FK_password_reset_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
