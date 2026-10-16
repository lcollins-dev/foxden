import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  CreatePasswordResetResponseDto,
  IdParamDto,
  UpdateStateRequestDto,
  UpdateUserRequestDto,
  UserDto,
  UserListRequestDto,
  UserListResponseDto,
  UserStatsResponseDto,
  PageParamDto,
  UserRoleId,
} from '@libs/dto';

import { AllowedRoles } from './decorators/allowed-roles.decorator';
import { GetUser } from './decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { UserAdminService } from './user-admin.service';
import { UserService } from '@/core/user/user.service';

export const OWN_ACCOUNT_MESSAGE = 'Another admin has to change your role, disable or delete your account.';
export const OWN_PROFILE_MESSAGE = 'Change your own name and email in Profile & security.';
export const OWN_PASSWORD_RESET_MESSAGE = 'Change your own password in Profile & security.';

function sameRoles(left: number[], right: number[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return leftSet.size === rightSet.size && [...leftSet].every(roleId => rightSet.has(roleId));
}

@Controller('api/v1/admin/user')
@AllowedRoles(UserRoleId.USER_ADMIN)
export class UserAdminController {
  constructor(
    private readonly userService: UserService,
    private readonly userAdminService: UserAdminService
  ) {}

  @Get('stats')
  getUserStats(): Promise<UserStatsResponseDto> {
    return this.userAdminService.getUserStats();
  }

  @Patch('list')
  getUserList(
    @Body(new ZodPipe(UserListRequestDto)) userListDto: UserListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<UserListResponseDto> {
    return this.userAdminService.getUserList(userListDto, page);
  }

  @Get(':userId')
  getUser(@Param('userId', new ZodPipe(IdParamDto)) userId: number): Promise<UserDto> {
    return this.userAdminService.getUser(userId);
  }

  @Patch(':userId')
  async updateUser(
    @GetUser() caller: User,
    @Param('userId', new ZodPipe(IdParamDto)) userId: number,
    @Body(new ZodPipe(UpdateUserRequestDto)) updateUserDto: UpdateUserRequestDto
  ): Promise<void> {
    const callerRoleIds = (caller.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId);

    if (userId === caller.id && !sameRoles(updateUserDto.userRoleIds, callerRoleIds)) {
      throw new BadRequestException(OWN_ACCOUNT_MESSAGE);
    }

    // The own address changes only through Profile & security, which asks for the current password.
    if (userId === caller.id && (updateUserDto.name !== caller.name || updateUserDto.email.trim() !== caller.email)) {
      throw new BadRequestException(OWN_PROFILE_MESSAGE);
    }

    await this.userService.updateAccount(updateUserDto.name, updateUserDto.email, updateUserDto.userRoleIds, userId);
  }

  @Patch(':userId/state')
  async updateState(
    @GetUser() caller: User,
    @Param('userId', new ZodPipe(IdParamDto)) userId: number,
    @Body(new ZodPipe(UpdateStateRequestDto)) updateStateDto: UpdateStateRequestDto
  ): Promise<void> {
    if (userId === caller.id && !updateStateDto.enabled) {
      throw new BadRequestException(OWN_ACCOUNT_MESSAGE);
    }

    await this.userAdminService.updateState(updateStateDto.enabled, userId);

    if (!updateStateDto.enabled) {
      await this.userService.invalidateSessions(userId);
    }
  }

  @Post(':userId/password-reset')
  async createPasswordReset(
    @GetUser() caller: User,
    @Param('userId', new ZodPipe(IdParamDto)) userId: number
  ): Promise<CreatePasswordResetResponseDto> {
    if (userId === caller.id) {
      throw new BadRequestException(OWN_PASSWORD_RESET_MESSAGE);
    }

    return this.userAdminService.createPasswordReset(userId);
  }

  /** Wipes the account's Sync storage too. */
  @Delete(':userId')
  async deleteUser(@GetUser() caller: User, @Param('userId', new ZodPipe(IdParamDto)) userId: number): Promise<void> {
    if (userId === caller.id) {
      throw new BadRequestException(OWN_ACCOUNT_MESSAGE);
    }

    await this.userService.deleteAccount(userId);
  }
}
