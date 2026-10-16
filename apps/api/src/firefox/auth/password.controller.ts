import { Body, Controller, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { FxaSession, FxaSessionGuard } from '@/firefox/fxa/fxa-session.guard';
import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { PasswordChangeFinishDto, PasswordChangeStartDto } from './dto/password-change.dto';

import { IResolvedSession } from '@/core/session/session.service';
import { AccountService } from '@/core/user/account.service';

import { readUserAgent } from './request-context';

export interface IPasswordChangeStartResponse {
  keyFetchToken2: string;
  passwordChangeToken: string;
  verified: true;
}

export interface IPasswordChangeFinishResponse {
  uid: string;
  sessionToken: string;
  verified: true;
  authAt: number;
  keyFetchToken2?: string;
}

/**
 * Password change routes of the auth server (fxa-auth-server/lib/routes/password.ts), with v2 credentials only. The
 * key fetch token is named `keyFetchToken2`, as Mozilla names the v2 one on these routes.
 */
@Controller('auth/v1/password/change')
export class PasswordController {
  constructor(private readonly accountService: AccountService) {}

  @Post('start')
  @HttpCode(200)
  @UseGuards(FxaSessionGuard)
  async start(
    @FxaSession() resolved: IResolvedSession,
    @Body(new FxaZodPipe(PasswordChangeStartDto)) body: PasswordChangeStartDto
  ): Promise<IPasswordChangeStartResponse> {
    const started = await this.accountService.startPasswordChange(resolved, body.email, body.oldAuthPW);

    return { keyFetchToken2: started.keyFetchToken, passwordChangeToken: started.passwordChangeToken, verified: true };
  }

  /** Authenticated by the passwordChangeToken (`Bearer fxpc_` or Hawk), not a session token. */
  @Post('finish')
  @HttpCode(200)
  async finish(
    @Headers('authorization') authorization: string | undefined,
    @Body(new FxaZodPipe(PasswordChangeFinishDto)) body: PasswordChangeFinishDto,
    @Query('keys', new FxaZodPipe(z.unknown())) keys: unknown,
    @Req() request: Request
  ): Promise<IPasswordChangeFinishResponse> {
    const { user, session, sessionToken, keyFetchToken } = await this.accountService.finishPasswordChange(
      authorization,
      {
        authPw: body.authPWVersion2,
        wrapKb: body.wrapKbVersion2,
        clientSalt: body.clientSalt,
        sessionTokenId: body.sessionToken.toLowerCase(),
      },
      keys === 'true',
      readUserAgent(request)
    );

    const response: IPasswordChangeFinishResponse = {
      uid: user.uid,
      sessionToken,
      verified: true,
      authAt: Math.floor(session.authAt / 1000),
    };

    if (keyFetchToken !== null) {
      response.keyFetchToken2 = keyFetchToken;
    }

    return response;
  }
}
