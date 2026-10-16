import { Module } from '@nestjs/common';

import { AccessTokenVerificationService } from './access-token-verification.service';
import { SyncSecretService } from './sync-secret.service';
import { TokenserverService } from './tokenserver.service';
import { PublicBaseUrlService } from '@/common/public-base-url.service';

import { OauthModule } from '@/core/oauth/oauth.module';
import { StorageModule } from '@/core/storage/storage.module';
import { SyncDatabaseModule } from '@/database/sync-database.module';

import { TokenserverUserRepository } from './tokenserver-user.repository';

@Module({
  imports: [OauthModule, StorageModule, SyncDatabaseModule],
  providers: [
    AccessTokenVerificationService,
    PublicBaseUrlService,
    SyncSecretService,
    TokenserverService,
    TokenserverUserRepository,
  ],
  exports: [AccessTokenVerificationService, SyncSecretService, TokenserverService],
})
export class TokenserverModule {}
