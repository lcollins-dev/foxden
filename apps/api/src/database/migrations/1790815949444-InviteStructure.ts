import { MigrationInterface, QueryRunner } from 'typeorm';

export class InviteStructure1790815949444 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "invite" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tokenHash" text NOT NULL,
        "email" text NOT NULL,
        "name" text NOT NULL,
        "admin" boolean NOT NULL,
        "expiresAt" integer NOT NULL,
        "createdAt" integer NOT NULL,
        "usedAt" integer,
        CONSTRAINT "UQ_invite_token_hash" UNIQUE ("tokenHash")
      );
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
