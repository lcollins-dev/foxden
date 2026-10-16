import { Module } from '@nestjs/common';

import { StorageService } from './storage.service';

import { BatchJobModule } from '@/core/batch-job/batch-job.module';
import { SyncDatabaseModule } from '@/database/sync-database.module';

import { PurgeExpiredSyncDataJob } from './purge-expired-sync-data.job';
import { StorageRepository } from './storage.repository';

@Module({
  imports: [BatchJobModule, SyncDatabaseModule],
  providers: [StorageService, StorageRepository, PurgeExpiredSyncDataJob],
  exports: [StorageService, StorageRepository],
})
export class StorageModule {}
