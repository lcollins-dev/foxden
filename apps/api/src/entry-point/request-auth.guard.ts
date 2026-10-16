import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AuthGuard } from '@/api/v1/user/guards/auth.guard';

import { isFirefoxSurface, ISurfacedRequest, RequestSurface } from './request-surface';

/**
 * The one global auth guard. The management API takes a session token on every route not marked `@NoAuth()`; the
 * Firefox surfaces authenticate with their own schemes on the routes that need one (`FxaSessionGuard`,
 * `HawkAuthGuard`). Anything outside both is held to the session guard rather than let through.
 */
@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const { surface = RequestSurface.OTHER } = context.switchToHttp().getRequest<ISurfacedRequest>();

    return isFirefoxSurface(surface) ? true : this.authGuard.canActivate(context);
  }
}
