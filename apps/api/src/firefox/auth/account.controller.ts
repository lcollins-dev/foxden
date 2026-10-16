import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { FxaSession, FxaSessionGuard } from '@/firefox/fxa/fxa-session.guard';
import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { AccountCreateDto } from './dto/account-create.dto';
import { AccountEmailDto } from './dto/account-email.dto';
import { AccountLoginDto } from './dto/account-login.dto';

import { IResolvedSession } from '@/core/session/session.service';
import { AccountService, ISignIn } from '@/core/user/account.service';

import { readLocale, readUserAgent } from './request-context';
import { HEX_16_BYTES } from '@/firefox/fxa/patterns';

/** Mozilla's create and login responses, with every verification flag true since nothing here needs confirming. */
export interface ISignInResponse {
  uid: string;
  sessionToken: string;
  keyFetchTokenVersion2?: string;
  authAt: number;
  metricsEnabled: boolean;
  emailVerified: true;
  sessionVerified: true;
  verified: true;
}

function signInResponse({ user, session, sessionToken, keyFetchToken }: ISignIn): ISignInResponse {
  const response: ISignInResponse = {
    uid: user.uid,
    sessionToken,
    authAt: Math.floor(session.authAt / 1000),
    metricsEnabled: false,
    emailVerified: true,
    sessionVerified: true,
    verified: true,
  };

  if (keyFetchToken !== null) {
    response.keyFetchTokenVersion2 = keyFetchToken;
  }

  return response;
}

/** Account routes of the auth server (fxa-auth-server/lib/routes/account.ts). */
@Controller('auth/v1')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  /** v2 credentials only; `authPW` and `wrapKb` (v1) are accepted and ignored. */
  @Post('account/create')
  @HttpCode(200)
  async create(
    @Body(new FxaZodPipe(AccountCreateDto)) body: AccountCreateDto,
    @Query('keys', new FxaZodPipe(z.unknown())) keys: unknown,
    @Req() request: Request
  ): Promise<ISignInResponse> {
    const signIn = await this.accountService.create(
      {
        email: body.email,
        authPw: body.authPWVersion2,
        wrapKb: body.wrapKbVersion2,
        clientSalt: body.clientSalt,
        inviteToken: body.inviteToken,
      },
      keys === 'true',
      readLocale(request),
      readUserAgent(request)
    );

    return signInResponse(signIn);
  }

  /** Our sign-in page for Firefox sends `service`; the web app's own sign-in does not. */
  @Post('account/login')
  @HttpCode(200)
  async login(
    @Body(new FxaZodPipe(AccountLoginDto)) body: AccountLoginDto,
    @Query('keys', new FxaZodPipe(z.unknown())) keys: unknown,
    @Req() request: Request
  ): Promise<ISignInResponse> {
    return signInResponse(
      await this.accountService.login(
        body.email,
        body.authPW,
        keys === 'true',
        readUserAgent(request),
        body.service !== undefined
      )
    );
  }

  @Post('account/credentials/status')
  @HttpCode(200)
  async credentialsStatus(
    @Body(new FxaZodPipe(AccountEmailDto)) body: AccountEmailDto
  ): Promise<{ currentVersion: 'v2'; clientSalt: string; upgradeNeeded: false }> {
    return {
      currentVersion: 'v2',
      clientSalt: await this.accountService.findClientSalt(body.email),
      upgradeNeeded: false,
    };
  }

  @Post('account/status')
  @HttpCode(200)
  async statusByEmail(@Body(new FxaZodPipe(AccountEmailDto)) body: AccountEmailDto): Promise<{ exists: boolean }> {
    return { exists: await this.accountService.existsByEmail(body.email) };
  }

  /** `false` makes Firefox sign out locally; `true` sends it to "needs reauth". */
  @Get('account/status')
  async statusByUid(
    @Query('uid', new FxaZodPipe(z.string().regex(HEX_16_BYTES))) uid: string
  ): Promise<{ exists: boolean }> {
    return { exists: await this.accountService.existsByUid(uid) };
  }

  @Get('account/keys')
  async keys(@Headers('authorization') authorization: string | undefined): Promise<{ bundle: string }> {
    return { bundle: await this.accountService.fetchKeys(authorization) };
  }

  @Get('recovery_email/status')
  @UseGuards(FxaSessionGuard)
  recoveryEmailStatus(@FxaSession() { user }: IResolvedSession) {
    return { email: user.email, verified: true, sessionVerified: true, emailVerified: true };
  }
}
