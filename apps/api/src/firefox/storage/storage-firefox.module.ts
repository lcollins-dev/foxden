import { Module } from '@nestjs/common';

import { HawkAuthGuard } from './hawk-auth.guard';

import { PublicBaseUrlService } from '@/common/public-base-url.service';

import { StorageFallbackController } from './storage-fallback.controller';
import { StorageController } from './storage.controller';

import { StorageModule } from '@/core/storage/storage.module';
import { TokenserverModule } from '@/core/tokenserver/tokenserver.module';

@Module({
  imports: [StorageModule, TokenserverModule],
  // The fallback answers what the storage controller leaves unmatched, so it registers last.
  controllers: [StorageController, StorageFallbackController],
  providers: [HawkAuthGuard, PublicBaseUrlService],
})
export class StorageFirefoxModule {}
