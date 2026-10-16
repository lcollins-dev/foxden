import { Module } from '@nestjs/common';

import { DatabaseBackupService } from './database-backup.service';

@Module({
  providers: [DatabaseBackupService],
  exports: [DatabaseBackupService],
})
export class DatabaseBackupModule {}
