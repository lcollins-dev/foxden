import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';

import {
  CreateInviteRequestDto,
  CreateInviteResponseDto,
  IdParamDto,
  InviteListResponseDto,
  UserRoleId,
} from '@libs/dto';

import { AllowedRoles } from '@/api/v1/user/decorators/allowed-roles.decorator';
import { GetUser } from '@/api/v1/user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { InviteService } from '@/core/invite/invite.service';
import { EmailService } from '@/email/email.service';

export const INVITE_MISSING_MESSAGE = "This invite doesn't exist or is no longer pending";

@Controller('api/v1/admin/invite')
@AllowedRoles(UserRoleId.USER_ADMIN)
export class InviteAdminController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly emailService: EmailService
  ) {}

  @Post()
  async createInvite(
    @GetUser() user: User,
    @Body(new ZodPipe(CreateInviteRequestDto)) createInviteDto: CreateInviteRequestDto
  ): Promise<CreateInviteResponseDto> {
    const { invite, link, emailSent } = await this.inviteService.inviteByEmail(
      createInviteDto.email,
      createInviteDto.name,
      createInviteDto.admin,
      user
    );

    return { link, expiresAt: new Date(invite.expiresAt).toJSON(), emailSent };
  }

  @Get('list')
  async getInviteList(): Promise<InviteListResponseDto> {
    const invites = await this.inviteService.listPending();

    return {
      inviteList: invites.map(invite => ({
        id: invite.id,
        email: invite.email,
        name: invite.name,
        admin: invite.admin,
        createdAt: new Date(invite.createdAt).toJSON(),
        expiresAt: new Date(invite.expiresAt).toJSON(),
      })),
      emailConfigured: this.emailService.isConfigured(),
    };
  }

  @Delete(':inviteId')
  async revokeInvite(@Param('inviteId', new ZodPipe(IdParamDto)) inviteId: number): Promise<void> {
    if (!(await this.inviteService.revoke(inviteId))) {
      throw new NotFoundException(INVITE_MISSING_MESSAGE);
    }
  }
}
