import { MigrationInterface, QueryRunner } from 'typeorm';

import { BatchJobId } from '@libs/dto';

export class SystemStructure1790815949488 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "batch_job" (
        "id" integer PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "desc" text NOT NULL,
        "cronExpression" text NULL,
        "enabled" boolean NOT NULL,
        "lastStartDate" datetime NULL,
        "lastSuccessDate" datetime NULL,
        "lastFailDate" datetime NULL
      );
    `);

    await queryRunner.query('INSERT INTO batch_job (id, "name", "desc", enabled) VALUES (?, ?, ?, ?)', [
      BatchJobId.PURGE_EXPIRED_SYNC_DATA,
      'Purge expired sync data',
      'Deletes sync records whose TTL has passed and batch uploads that were never committed',
      1,
    ]);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
