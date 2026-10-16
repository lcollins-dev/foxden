import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyFetchToken } from './entities/key-fetch-token.entity';
import { PasswordChangeToken } from './entities/password-change-token.entity';
import { UserRole } from './entities/user-role.entity';
import { UserUserRole } from './entities/user-user-role.entity';
import { User } from './entities/user.entity';

import { AccountService } from './account.service';
import { DefaultAdminService } from './default-admin.service';
import { UserService } from './user.service';

import { PasswordResetModule } from './password-reset/password-reset.module';
import { InviteModule } from '@/core/invite/invite.module';
import { OauthModule } from '@/core/oauth/oauth.module';
import { SessionModule } from '@/core/session/session.module';
import { TokenserverModule } from '@/core/tokenserver/tokenserver.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, UserUserRole, KeyFetchToken, PasswordChangeToken]),
    InviteModule,
    OauthModule,
    PasswordResetModule,
    SessionModule,
    TokenserverModule,
  ],
  providers: [AccountService, DefaultAdminService, UserService],
  exports: [AccountService, UserService],
})
export class UserModule {}
