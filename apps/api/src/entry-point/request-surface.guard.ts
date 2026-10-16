import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { ISurfacedRequest, requestSurface } from './request-surface';

/**
 * Stamps the surface on every request a route took, and never refuses one. Guards run only once routing has chosen a
 * route, and this one runs first, so the stamp is there for every other guard, the handler and the exception filter,
 * and missing from an unknown path or a body the parser refused.
 */
@Injectable()
export class RequestSurfaceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ISurfacedRequest>();

    request.surface = requestSurface(request.path);

    return true;
  }
}
