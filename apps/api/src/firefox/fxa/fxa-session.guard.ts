import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { IResolvedSession, SessionService } from '@/core/session/session.service';

import { fxaErrors } from '@/firefox/fxa/fxa-error';

export interface IFxaSessionRequest extends Request {
  fxaSession?: IResolvedSession;
}

/** Requires a session token (Bearer `fxs_` or Hawk) and answers errno 110 without one, which Firefox acts on. */
@Injectable()
export class FxaSessionGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IFxaSessionRequest>();
    const resolved = await this.sessionService.resolve(request.headers.authorization);

    if (resolved === null) {
      throw fxaErrors.invalidToken();
    }

    request.fxaSession = resolved;

    return true;
  }
}

// Decorators are PascalCase, as GetUser and NoAuth are.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const FxaSession = createParamDecorator((_data: unknown, context: ExecutionContext): IResolvedSession => {
  const request = context.switchToHttp().getRequest<IFxaSessionRequest>();

  if (request.fxaSession === undefined) {
    throw fxaErrors.invalidToken();
  }

  return request.fxaSession;
});
