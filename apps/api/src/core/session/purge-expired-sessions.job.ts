import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BatchJobId } from '@libs/dto';

import { SessionService } from './session.service';
import { ConfigService } from '@/config/config.service';
import { BatchJobRunner, BatchJobService } from '@/core/batch-job/batch-job.service';

@Injectable()
export class PurgeExpiredSessionsJob implements BatchJobRunner, OnModuleInit {
  private readonly logger = new Logger(PurgeExpiredSessionsJob.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly batchJobService: BatchJobService,
    private readonly sessionService: SessionService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.batchJobService.registerBatchJob(
      BatchJobId.PURGE_EXPIRED_SESSIONS,
      this.configService.batchJobPurgeExpiredSessionsCron,
      this
    );
  }

  async run(): Promise<void> {
    const sessions = await this.sessionService.purgeExpired(Date.now());

    this.logger.log({ sessions }, 'run(): Purged expired sessions');
  }
}
