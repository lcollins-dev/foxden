import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';

import { FxaSession, FxaSessionGuard } from '@/firefox/fxa/fxa-session.guard';
import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { AuthorizationDto } from './dto/authorization.dto';
import { DestroyDto } from './dto/destroy.dto';
import { ScopedKeyDataDto } from './dto/scoped-key-data.dto';
import { TokenDto } from './dto/token.dto';

import { ITokenResponse, OauthFirefoxService } from './oauth-firefox.service';
import { OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession } from '@/core/session/session.service';

import { fxaErrors } from '@/firefox/fxa/fxa-error';

export interface IScopedKeyData {
  identifier: string;
  keyRotationSecret: string;
  keyRotationTimestamp: number;
}

export interface IAuthorizationResponse {
  code: string;
  state: string;
  redirect: string;
  scope: string;
}

/** The OAuth routes Firefox and our web UI call on the auth server (fxa-auth-server/lib/routes/oauth/). */
@Controller('auth/v1')
export class AuthServerOauthController {
  constructor(
    private readonly oauthFirefoxService: OauthFirefoxService,
    private readonly oauthService: OauthService
  ) {}

  @Post('account/scoped-key-data')
  @HttpCode(200)
  @UseGuards(FxaSessionGuard)
  scopedKeyData(
    @FxaSession() { user }: IResolvedSession,
    @Body(new FxaZodPipe(ScopedKeyDataDto)) body: ScopedKeyDataDto
  ): Record<string, IScopedKeyData> {
    const scopedKeys = this.oauthService.scopedKeys(user, body.client_id, body.scope);

    return Object.fromEntries(
      scopedKeys.map(scopedKey => [
        scopedKey.identifier,
        {
          identifier: scopedKey.identifier,
          keyRotationSecret: scopedKey.keyRotationSecret,
          keyRotationTimestamp: scopedKey.keyRotationTimestamp,
        },
      ])
    );
  }

  @Post('oauth/authorization')
  @HttpCode(200)
  @UseGuards(FxaSessionGuard)
  async authorize(
    @FxaSession() resolved: IResolvedSession,
    @Body(new FxaZodPipe(AuthorizationDto)) body: AuthorizationDto
  ): Promise<IAuthorizationResponse> {
    const client = this.oauthService.findClientWithThrow(body.client_id);

    if ((body.response_type ?? 'code') !== 'code') {
      throw fxaErrors.invalidResponseType();
    }

    if (body.redirect_uri !== undefined && body.redirect_uri !== client.redirectUri) {
      throw fxaErrors.incorrectRedirectUri(body.redirect_uri);
    }

    if (body.code_challenge === undefined || body.code_challenge_method !== 'S256') {
      throw fxaErrors.missingPkceParameters();
    }

    const issued = await this.oauthService.authorize(resolved, client, {
      state: body.state,
      scope: body.scope,
      codeChallenge: body.code_challenge,
      keysJwe: body.keys_jwe ?? null,
      offline: body.access_type === 'offline',
    });

    return { code: issued.code, state: body.state, redirect: issued.redirect, scope: issued.scope };
  }

  @Post('oauth/token')
  @HttpCode(200)
  token(
    @Body(new FxaZodPipe(TokenDto)) body: TokenDto,
    @Headers('authorization') authorization: string | undefined
  ): Promise<ITokenResponse> {
    return this.oauthFirefoxService.token(body, authorization);
  }

  @Post('oauth/destroy')
  @HttpCode(200)
  destroy(@Body(new FxaZodPipe(DestroyDto)) body: DestroyDto): Promise<object> {
    return this.oauthFirefoxService.destroy(body);
  }
}
