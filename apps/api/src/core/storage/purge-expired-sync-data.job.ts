import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BatchJobId } from '@libs/dto';

import { ConfigService } from '@/config/config.service';
import { BatchJobRunner, BatchJobService } from '@/core/batch-job/batch-job.service';
import { SyncDatabaseService } from '@/database/sync-database.service';

import { StorageRepository } from './storage.repository';

@Injectable()
export class PurgeExpiredSyncDataJob implements BatchJobRunner, OnModuleInit {
  private readonly logger = new Logger(PurgeExpiredSyncDataJob.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly batchJobService: BatchJobService,
    private readonly syncDatabase: SyncDatabaseService,
    private readonly storageRepository: StorageRepository
  ) {}

  async onModuleInit(): Promise<void> {
    await this.batchJobService.registerBatchJob(
      BatchJobId.PURGE_EXPIRED_SYNC_DATA,
      this.configService.batchJobPurgeExpiredSyncDataCron,
      this
    );
  }

  async run(): Promise<void> {
    const purged = await this.syncDatabase.write(db => this.storageRepository.purgeExpired(db, Date.now()));

    this.logger.log(purged, 'run(): Purged expired sync data');
  }
}
