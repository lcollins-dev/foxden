import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { IFxaSessionRequest } from '@/firefox/fxa/fxa-session.guard';

import { OauthService, REFRESH_TOKEN_PATTERN } from '@/core/oauth/oauth.service';
import { SessionService } from '@/core/session/session.service';

import { fxaErrors } from '@/firefox/fxa/fxa-error';

/**
 * The device routes: a session token as `FxaSessionGuard` takes it, or `Bearer <refresh token>`, which Firefox for
 * Android and iOS send (application-services fxa-client/src/internal/http_client.rs). A refresh token stands for the
 * session it was issued under, so it reaches that session's device.
 */
@Injectable()
export class FxaDeviceCredentialGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly oauthService: OauthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IFxaSessionRequest>();
    const authorization = request.headers.authorization;
    const bearer = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const refreshToken = bearer !== undefined && REFRESH_TOKEN_PATTERN.test(bearer) ? bearer : undefined;

    const resolved =
      refreshToken === undefined
        ? await this.sessionService.resolve(authorization)
        : await this.oauthService.resolveRefreshTokenSession(refreshToken);

    if (resolved === null) {
      throw fxaErrors.invalidToken();
    }

    if (refreshToken !== undefined) {
      await this.sessionService.recordAccess(resolved.session);
    }

    request.fxaSession = resolved;

    return true;
  }
}
