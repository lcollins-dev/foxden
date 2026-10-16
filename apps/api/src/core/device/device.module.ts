import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Device } from './entities/device.entity';

import { DeviceService } from './device.service';

import { SessionModule } from '@/core/session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), SessionModule],
  providers: [DeviceService],
  exports: [DeviceService],
})
export class DeviceModule {}
