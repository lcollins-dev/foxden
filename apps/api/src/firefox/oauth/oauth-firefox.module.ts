import { Module } from '@nestjs/common';

import { OauthFirefoxService } from './oauth-firefox.service';

import { AuthServerOauthController } from './auth-server-oauth.controller';
import { OauthController } from './oauth.controller';

import { OauthModule } from '@/core/oauth/oauth.module';
import { SessionModule } from '@/core/session/session.module';

/** The OAuth server under `/oauth/v1`, and the OAuth routes the auth server mounts under `/auth/v1`. */
@Module({
  imports: [OauthModule, SessionModule],
  providers: [OauthFirefoxService],
  controllers: [AuthServerOauthController, OauthController],
})
export class OauthFirefoxModule {}
