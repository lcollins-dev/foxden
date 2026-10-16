import { Module } from '@nestjs/common';

import { PasswordResetController } from './password-reset.controller';

import { PasswordResetModule } from '@/core/user/password-reset/password-reset.module';
import { UserModule } from '@/core/user/user.module';

@Module({
  imports: [PasswordResetModule, UserModule],
  controllers: [PasswordResetController],
})
export class PasswordResetApiModule {}
