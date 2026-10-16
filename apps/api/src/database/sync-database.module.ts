import { Module } from '@nestjs/common';

import { SyncDatabaseService } from './sync-database.service';

@Module({
  providers: [SyncDatabaseService],
  exports: [SyncDatabaseService],
})
export class SyncDatabaseModule {}
