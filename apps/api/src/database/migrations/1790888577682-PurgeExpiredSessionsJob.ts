import { MigrationInterface, QueryRunner } from 'typeorm';

import { BatchJobId } from '@libs/dto';

export class PurgeExpiredSessionsJob1790888577682 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('INSERT INTO batch_job (id, "name", "desc", enabled) VALUES (?, ?, ?, ?)', [
      BatchJobId.PURGE_EXPIRED_SESSIONS,
      'Purge expired sessions',
      'Signs out sessions that never registered a device once they pass the configured expiry',
      1,
    ]);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
