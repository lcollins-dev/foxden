import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Invite } from './entities/invite.entity';
import { User } from '@/core/user/entities/user.entity';

import { InviteService } from './invite.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invite, User])],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
