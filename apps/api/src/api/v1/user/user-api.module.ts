import { Module } from '@nestjs/common';

import { UserAdminService } from './user-admin.service';

import { UserAdminController } from './user-admin.controller';
import { UserController } from './user.controller';

import { PasswordResetApiModule } from './password-reset/password-reset-api.module';
import { DeviceModule } from '@/core/device/device.module';
import { SessionModule } from '@/core/session/session.module';
import { PasswordResetModule } from '@/core/user/password-reset/password-reset.module';
import { UserModule } from '@/core/user/user.module';

@Module({
  imports: [DeviceModule, PasswordResetApiModule, PasswordResetModule, SessionModule, UserModule],
  providers: [UserAdminService],
  controllers: [UserController, UserAdminController],
})
export class UserApiModule {}
