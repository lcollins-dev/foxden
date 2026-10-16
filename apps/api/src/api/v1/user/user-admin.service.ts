import { BadRequestException, Injectable } from '@nestjs/common';

import {
  CreatePasswordResetResponseDto,
  ListUserDto,
  UserDto,
  UserListRequestDto,
  UserListResponseDto,
  UserStatsResponseDto,
  UserListRole,
  UserListStatus,
} from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import { SessionService } from '@/core/session/session.service';
import { PasswordResetService } from '@/core/user/password-reset/password-reset.service';
import { UserService } from '@/core/user/user.service';

export const PASSWORD_RESET_DISABLED_MESSAGE = 'Enable the account before resetting its password.';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionService: SessionService,
    private readonly userService: UserService
  ) {}

  async getUserList(userListRequest: UserListRequestDto, page: number): Promise<UserListResponseDto> {
    const pageSize = this.configService.pageSize;
    const role = userListRequest.role ?? UserListRole.ALL;

    const [users, total] = await this.userService.findAndCount(
      {
        search: userListRequest.search,
        enabled:
          userListRequest.status === UserListStatus.ALL ? undefined : userListRequest.status === UserListStatus.ENABLED,
        admin: role === UserListRole.ALL ? undefined : role === UserListRole.ADMIN,
      },
      pageSize * (page - 1),
      pageSize
    );

    const lastSessionAccess = await this.sessionService.lastAccessByUser(users.map(user => user.id));

    return {
      userList: users.map(user => this.toListUser(user, lastSessionAccess.get(user.id))),
      pages: Math.ceil(total / pageSize),
      total,
    };
  }

  async getUserStats(): Promise<UserStatsResponseDto> {
    const { total, enabled } = await this.userService.countByState();

    return {
      total,
      enabled,
      disabled: total - enabled,
    };
  }

  async getUser(userId: number): Promise<UserDto> {
    const user = await this.userService.findWithThrow(userId, true);
    const lastSessionAccess = await this.sessionService.lastAccessByUser([user.id]);
    const passwordReset = await this.passwordResetService.findPending(user.id);

    return {
      ...this.toListUser(user, lastSessionAccess.get(user.id)),
      uid: user.uid,
      lastLoginSuccess: user.lastLoginSuccess?.toJSON() ?? null,
      lastLoginFail: user.lastLoginFail?.toJSON() ?? null,
      passwordResetExpiresAt: passwordReset === null ? null : new Date(passwordReset.expiresAt).toJSON(),
    };
  }

  /** Replaces any pending link of the account. A disabled account could not use one. */
  async createPasswordReset(userId: number): Promise<CreatePasswordResetResponseDto> {
    const user = await this.userService.findWithThrow(userId);

    if (!user.enabled) {
      throw new BadRequestException(PASSWORD_RESET_DISABLED_MESSAGE);
    }

    const { passwordReset, link } = await this.passwordResetService.create(user.id);

    return { link, expiresAt: new Date(passwordReset.expiresAt).toJSON() };
  }

  /** Disabling also revokes a pending reset link, so enabling the account again does not revive it. */
  async updateState(enabled: boolean, userId: number): Promise<void> {
    await this.userService.setEnabled(userId, enabled);

    if (!enabled) {
      await this.passwordResetService.revoke(userId);
    }
  }

  /** Activity is the latest sign-in or session use; `user.lastAccess` moves on every row update. */
  private toListUser(user: User, lastSessionAccess: number | undefined): ListUserDto {
    const lastActive = Math.max(user.lastLoginSuccess?.getTime() ?? 0, lastSessionAccess ?? 0);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      enabled: user.enabled,
      userRoleIds: (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId),
      createdDate: user.createdDate.toJSON(),
      lastActiveAt: lastActive > 0 ? new Date(lastActive).toJSON() : null,
    };
  }
}
