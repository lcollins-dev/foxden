import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { JSONWebKeySet } from 'jose';

import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { DestroyDto } from './dto/destroy.dto';
import { TokenDto } from './dto/token.dto';
import { VerifyDto } from './dto/verify.dto';

import { ITokenResponse, OauthFirefoxService } from './oauth-firefox.service';
import { AccessTokenService } from '@/core/oauth/access-token.service';
import { OauthService } from '@/core/oauth/oauth.service';
import { SigningKeyService } from '@/core/oauth/signing-key.service';

import { fxaErrors } from '@/firefox/fxa/fxa-error';

export interface IVerifyResponse {
  user: string;
  client_id: string;
  scope: string[];
  generation: number;
}

export interface IIntrospectResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  sub?: string;
  token_type?: 'access_token' | 'refresh_token';
  exp?: number;
  iat?: number;
  jti?: string;
}

/** The OAuth server base (`oauth_server_base_url` + `/v1`), where the tokenserver fetches keys and verifies tokens. */
@Controller('oauth/v1')
export class OauthController {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly oauthFirefoxService: OauthFirefoxService,
    private readonly oauthService: OauthService,
    private readonly signingKeyService: SigningKeyService
  ) {}

  @Post('token')
  @HttpCode(200)
  token(
    @Body(new FxaZodPipe(TokenDto)) body: TokenDto,
    @Headers('authorization') authorization: string | undefined
  ): Promise<ITokenResponse> {
    return this.oauthFirefoxService.token(body, authorization);
  }

  @Post('destroy')
  @HttpCode(200)
  destroy(@Body(new FxaZodPipe(DestroyDto)) body: DestroyDto): Promise<object> {
    return this.oauthFirefoxService.destroy(body);
  }

  /** The fallback syncstorage-rs uses when it cannot check a JWT itself. */
  @Post('verify')
  @HttpCode(200)
  async verify(@Body(new FxaZodPipe(VerifyDto)) body: VerifyDto): Promise<IVerifyResponse> {
    const verified = await this.accessTokenService.verify(body.token);

    if (verified === null) {
      throw fxaErrors.invalidToken('Invalid token');
    }

    return {
      user: verified.user.uid,
      client_id: verified.record.clientId,
      scope: verified.scopes,
      generation: verified.user.verifierSetAt,
    };
  }

  /** RFC 7662 introspection for access and refresh tokens, as the openid-configuration advertises. */
  @Post('introspect')
  @HttpCode(200)
  async introspect(@Body(new FxaZodPipe(VerifyDto)) body: VerifyDto): Promise<IIntrospectResponse> {
    const introspected = await this.oauthService.introspect(body.token);

    if (introspected === null) {
      return { active: false };
    }

    if (introspected.kind === 'access-token') {
      const { verified } = introspected;

      return {
        active: true,
        token_type: 'access_token',
        scope: verified.record.scope,
        client_id: verified.record.clientId,
        sub: verified.user.uid,
        exp: verified.claims.exp,
        iat: verified.claims.iat,
        jti: verified.record.jti,
      };
    }

    const { refreshToken, user } = introspected;

    return {
      active: true,
      token_type: 'refresh_token',
      scope: refreshToken.scope,
      client_id: refreshToken.clientId,
      sub: user.uid,
      iat: Math.floor(refreshToken.createdAt / 1000),
    };
  }

  @Get('jwks')
  jwks(): Promise<JSONWebKeySet> {
    return this.signingKeyService.getPublicJwks();
  }
}
