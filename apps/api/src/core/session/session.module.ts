import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Session } from './entities/session.entity';
import { Device } from '@/core/device/entities/device.entity';

import { SessionService } from './session.service';

import { BatchJobModule } from '@/core/batch-job/batch-job.module';

import { PurgeExpiredSessionsJob } from './purge-expired-sessions.job';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Device]), BatchJobModule],
  providers: [SessionService, PurgeExpiredSessionsJob],
  exports: [SessionService],
})
export class SessionModule {}
