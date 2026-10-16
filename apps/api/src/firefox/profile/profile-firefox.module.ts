import { Module } from '@nestjs/common';

import { ProfileController } from './profile.controller';

import { OauthModule } from '@/core/oauth/oauth.module';

@Module({
  imports: [OauthModule],
  controllers: [ProfileController],
})
export class ProfileFirefoxModule {}
