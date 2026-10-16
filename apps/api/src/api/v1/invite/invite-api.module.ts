import { Module } from '@nestjs/common';

import { InviteAdminController } from './invite-admin.controller';
import { InviteController } from './invite.controller';

import { InviteModule } from '@/core/invite/invite.module';

@Module({
  imports: [InviteModule],
  controllers: [InviteAdminController, InviteController],
})
export class InviteApiModule {}
