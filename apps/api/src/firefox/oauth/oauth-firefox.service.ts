import { Injectable } from '@nestjs/common';

import { DestroyDto } from './dto/destroy.dto';
import { TokenDto } from './dto/token.dto';

import { IGrantedTokens, OauthService } from '@/core/oauth/oauth.service';
import { SessionService } from '@/core/session/session.service';

import { fxaErrors } from '@/firefox/fxa/fxa-error';

/** Every field Firefox reads; `scope` must be a string (Firefox calls `scope.includes`). */
export interface ITokenResponse {
  access_token: string;
  token_type: 'bearer';
  scope: string;
  expires_in: number;
  auth_at: number;
  refresh_token?: string;
  keys_jwe?: string;
}

function tokenResponse(granted: IGrantedTokens): ITokenResponse {
  const response: ITokenResponse = {
    access_token: granted.accessToken,
    token_type: 'bearer',
    scope: granted.scope,
    expires_in: granted.expiresIn,
    auth_at: Math.floor(granted.authAt / 1000),
  };

  if (granted.refreshToken !== null) {
    response.refresh_token = granted.refreshToken;
  }

  if (granted.keysJwe !== null) {
    response.keys_jwe = granted.keysJwe;
  }

  return response;
}

/**
 * The token and destroy endpoints, which the auth server (`/auth/v1/oauth/…`, what desktop calls) and the OAuth
 * server (`/oauth/v1/…`) both mount.
 */
@Injectable()
export class OauthFirefoxService {
  constructor(
    private readonly oauthService: OauthService,
    private readonly sessionService: SessionService
  ) {}

  /** The session token is optional for authorization_code and required for fxa-credentials. */
  async token(body: TokenDto, authorization: string | undefined): Promise<ITokenResponse> {
    const client = this.oauthService.findClientWithThrow(body.client_id);

    switch (body.grant_type) {
      case 'authorization_code': {
        if (body.code === undefined) {
          throw fxaErrors.missingParameter('code');
        }

        if (body.code_verifier === undefined) {
          throw fxaErrors.missingPkceParameters();
        }

        return tokenResponse(
          await this.oauthService.grantAuthorizationCode(client, body.code, body.code_verifier, body.ttl)
        );
      }
      case 'fxa-credentials': {
        const resolved = await this.sessionService.resolve(authorization);

        if (resolved === null) {
          throw fxaErrors.invalidToken();
        }

        if (body.scope === undefined) {
          throw fxaErrors.missingParameter('scope');
        }

        return tokenResponse(
          await this.oauthService.grantFxaCredentials(
            client,
            resolved,
            body.scope,
            body.ttl,
            body.access_type === 'offline'
          )
        );
      }
      case 'refresh_token': {
        if (body.refresh_token === undefined) {
          throw fxaErrors.missingParameter('refresh_token');
        }

        return tokenResponse(
          await this.oauthService.grantRefreshToken(client, body.refresh_token, body.scope, body.ttl)
        );
      }
    }
  }

  /** Always `{}`, since Firefox aborts sign-in on a failure here. */
  async destroy(body: DestroyDto): Promise<object> {
    const token = body.token ?? body.access_token ?? body.refresh_token;

    if (token !== undefined) {
      await this.oauthService.revoke(token);
    }

    return {};
  }
}
