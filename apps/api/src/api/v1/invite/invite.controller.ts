import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { CheckInviteRequestDto, CheckInviteResponseDto } from '@libs/dto';

import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { InviteService } from '@/core/invite/invite.service';

/** Lets the sign-up page show which address an invite is for. The token travels in the body to keep it out of logs. */
@NoAuth()
@Controller('api/v1/invite')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Post('check')
  @HttpCode(200)
  async checkInvite(
    @Body(new ZodPipe(CheckInviteRequestDto)) checkInviteDto: CheckInviteRequestDto
  ): Promise<CheckInviteResponseDto> {
    const { state, invite } = await this.inviteService.check(checkInviteDto.token);

    return {
      state,
      invite:
        invite === null
          ? null
          : { email: invite.email, admin: invite.admin, expiresAt: new Date(invite.expiresAt).toJSON() },
    };
  }
}
