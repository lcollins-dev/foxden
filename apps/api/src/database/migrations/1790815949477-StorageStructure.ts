import { MigrationInterface, QueryRunner } from 'typeorm';

export class StorageStructure1790815949477 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "storage_user" (
        "uid" integer PRIMARY KEY NOT NULL,
        "modified" integer NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "storage_collection" (
        "uid" integer NOT NULL,
        "collection" text NOT NULL,
        "modified" integer NOT NULL,
        PRIMARY KEY ("uid", "collection")
      ) WITHOUT ROWID;
    `);

    // A rowid table on purpose: SQLite advises WITHOUT ROWID only for small rows, and a payload reaches 2.5 MB.
    await queryRunner.query(`
      CREATE TABLE "storage_bso" (
        "uid" integer NOT NULL,
        "collection" text NOT NULL,
        "id" text NOT NULL,
        "sortindex" integer NULL,
        "payload" text NOT NULL DEFAULT '',
        "modified" integer NOT NULL,
        "expiry" integer NULL,
        CONSTRAINT "UQ_storage_bso_uid_collection_id" UNIQUE ("uid", "collection", "id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_storage_bso_uid_collection_modified_id" ON "storage_bso" ("uid", "collection", "modified", "id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_storage_bso_uid_collection_sortindex_id" ON "storage_bso" ("uid", "collection", "sortindex", "id");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_storage_bso_expiry" ON "storage_bso" ("expiry") WHERE "expiry" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE "storage_batch" (
        "uid" integer NOT NULL,
        "id" text NOT NULL,
        "collection" text NOT NULL,
        "created_at" integer NOT NULL,
        PRIMARY KEY ("uid", "id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_storage_batch_created_at" ON "storage_batch" ("created_at");
    `);

    // A NULL field means the upload did not provide it, so the commit keeps the stored value.
    await queryRunner.query(`
      CREATE TABLE "storage_batch_item" (
        "uid" integer NOT NULL,
        "batch_id" text NOT NULL,
        "id" text NOT NULL,
        "sortindex" integer NULL,
        "payload" text NULL,
        "ttl" integer NULL,
        PRIMARY KEY ("uid", "batch_id", "id"),
        CONSTRAINT "FK_storage_batch_item_storage_batch" FOREIGN KEY ("uid", "batch_id")
          REFERENCES "storage_batch" ("uid", "id") ON DELETE CASCADE
      );
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
