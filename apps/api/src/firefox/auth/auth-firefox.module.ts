import { Module } from '@nestjs/common';

import { AccountController } from './account.controller';
import { DeviceController } from './device.controller';
import { PasswordController } from './password.controller';
import { SessionController } from './session.controller';

import { DeviceModule } from '@/core/device/device.module';
import { OauthModule } from '@/core/oauth/oauth.module';
import { SessionModule } from '@/core/session/session.module';
import { UserModule } from '@/core/user/user.module';

/** The auth server Firefox signs in against, under `/auth/v1`; its OAuth routes live with the OAuth server's. */
@Module({
  imports: [DeviceModule, OauthModule, SessionModule, UserModule],
  controllers: [AccountController, SessionController, DeviceController, PasswordController],
})
export class AuthFirefoxModule {}
