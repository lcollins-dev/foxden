import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import {
  CheckPasswordResetRequestDto,
  CheckPasswordResetResponseDto,
  ResetPasswordRequestDto,
  ResetPasswordResponseDto,
} from '@libs/dto';

import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { AccountService } from '@/core/user/account.service';
import { PasswordResetService } from '@/core/user/password-reset/password-reset.service';

import { PasswordResetRefusal, PasswordResetRefusedError } from '@/core/user/password-reset/password-reset-refusal';

export const PASSWORD_RESET_INVALID_MESSAGE = "This reset link doesn't work any more. Ask your admin for a new one.";
export const PASSWORD_RESET_ACCOUNT_DISABLED_MESSAGE = 'This account is disabled. Ask your admin to enable it.';

function refusalMessage(refusal: PasswordResetRefusal): string {
  switch (refusal.reason) {
    case 'invalid-link':
      return PASSWORD_RESET_INVALID_MESSAGE;
    case 'account-disabled':
      return PASSWORD_RESET_ACCOUNT_DISABLED_MESSAGE;
  }
}

/** The reset page's routes. The token travels in the body to keep it out of logs. */
@NoAuth()
@Controller('api/v1/password-reset')
export class PasswordResetController {
  constructor(
    private readonly accountService: AccountService,
    private readonly passwordResetService: PasswordResetService
  ) {}

  @Post('check')
  @HttpCode(200)
  async checkPasswordReset(
    @Body(new ZodPipe(CheckPasswordResetRequestDto)) checkPasswordResetDto: CheckPasswordResetRequestDto
  ): Promise<CheckPasswordResetResponseDto> {
    const { state, passwordReset } = await this.passwordResetService.check(checkPasswordResetDto.token);

    return {
      state,
      passwordReset:
        passwordReset?.user === undefined
          ? null
          : { email: passwordReset.user.email, expiresAt: new Date(passwordReset.expiresAt).toJSON() },
    };
  }

  /** Re-keys the account, ends every session and answers a new one for the caller. */
  @Post()
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodPipe(ResetPasswordRequestDto)) resetPasswordDto: ResetPasswordRequestDto,
    @Req() request: Request
  ): Promise<ResetPasswordResponseDto> {
    try {
      const { sessionToken } = await this.accountService.resetPassword(
        {
          resetToken: resetPasswordDto.token,
          authPw: resetPasswordDto.authPw,
          clientSalt: resetPasswordDto.clientSalt,
        },
        request.get('user-agent')?.slice(0, 255) ?? null
      );

      return { sessionToken };
    } catch (error) {
      if (error instanceof PasswordResetRefusedError) {
        throw new BadRequestException(refusalMessage(error.refusal));
      }

      throw error;
    }
  }
}
