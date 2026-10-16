import { MigrationInterface, QueryRunner } from 'typeorm';

export class TokenserverStructure1790815949466 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tokenserver_secret" (
        "id" integer PRIMARY KEY NOT NULL CHECK ("id" = 1),
        "secret" text NOT NULL,
        "created_at" integer NOT NULL
      );
    `);

    // AUTOINCREMENT never hands out a uid again, even after its row is gone.
    await queryRunner.query(`
      CREATE TABLE "tokenserver_user" (
        "uid" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "fxa_uid" text NOT NULL,
        "generation" integer NOT NULL DEFAULT 0,
        "client_state" text NOT NULL DEFAULT '',
        "keys_changed_at" integer NULL,
        "created_at" integer NOT NULL,
        "replaced_at" integer NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tokenserver_user_fxa_uid_created_at_uid" ON "tokenserver_user" ("fxa_uid", "created_at", "uid");
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
