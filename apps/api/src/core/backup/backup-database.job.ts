import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BatchJobId } from '@libs/dto';

import { ConfigService } from '@/config/config.service';
import { BatchJobRunner, BatchJobService } from '@/core/batch-job/batch-job.service';
import { DatabaseBackupService } from '@/database/database-backup.service';

@Injectable()
export class BackupDatabaseJob implements BatchJobRunner, OnModuleInit {
  private readonly logger = new Logger(BackupDatabaseJob.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly batchJobService: BatchJobService,
    private readonly databaseBackupService: DatabaseBackupService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.batchJobService.registerBatchJob(
      BatchJobId.BACKUP_DATABASE,
      this.configService.batchJobBackupDatabaseCron,
      this
    );
  }

  async run(): Promise<void> {
    const directory = this.configService.backupPath;

    try {
      await this.databaseBackupService.backup(directory, this.configService.backupRetention, new Date());
    } catch (error) {
      this.logger.error({ directory, error }, 'run(): Failed to back up the database');

      throw error;
    }
  }
}
