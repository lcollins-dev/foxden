import { MigrationInterface, QueryRunner } from 'typeorm';

import { BatchJobId } from '@libs/dto';

export class BackupDatabaseJob1790965649705 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('INSERT INTO batch_job (id, "name", "desc", enabled) VALUES (?, ?, ?, ?)', [
      BatchJobId.BACKUP_DATABASE,
      'Back up database',
      'Writes a copy of the database to the backup directory and deletes the oldest copies beyond the configured retention',
      1,
    ]);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
