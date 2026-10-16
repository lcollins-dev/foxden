import { Module } from '@nestjs/common';

import { BatchJobModule } from '@/core/batch-job/batch-job.module';
import { DatabaseBackupModule } from '@/database/database-backup.module';

import { BackupDatabaseJob } from './backup-database.job';

@Module({
  imports: [BatchJobModule, DatabaseBackupModule],
  providers: [BackupDatabaseJob],
})
export class BackupModule {}
