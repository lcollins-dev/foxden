import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessToken } from './entities/access-token.entity';
import { AuthorizationCode } from './entities/authorization-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { SigningKey } from './entities/signing-key.entity';

import { AccessTokenService } from './access-token.service';
import { OauthService } from './oauth.service';
import { SigningKeyService } from './signing-key.service';

import { SessionModule } from '@/core/session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccessToken, AuthorizationCode, RefreshToken, SigningKey]), SessionModule],
  providers: [SigningKeyService, AccessTokenService, OauthService],
  exports: [SigningKeyService, AccessTokenService, OauthService],
})
export class OauthModule {}
