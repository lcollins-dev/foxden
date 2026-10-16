import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { intersection } from 'lodash';

import { UserRoleId } from '@libs/dto';

import { ALLOWED_ROLES_METADATA_KEY } from '../decorators/allowed-roles.decorator';
import { NO_AUTH_METADATA_KEY } from '../decorators/no-auth.decorator';

import { User } from '@/core/user/entities/user.entity';

import { SessionService } from '@/core/session/session.service';

export const SESSION_EXPIRED_MESSAGE = 'Your session is invalid or has expired, please login to continue';
export const NOT_ALLOWED_MESSAGE = 'You are not allowed to do this';
export const SETUP_REQUIRED_MESSAGE = 'Change the default password before doing anything else';

/** Marks a route the first-time setup screen needs, which an account held to setup may still call. */
export const ALLOWED_DURING_SETUP_METADATA_KEY = 'allowed-during-setup';

/** Authenticates `/api/v1` with the same session tokens Firefox uses (`Bearer fxs_<tokenId>`), unless `@NoAuth()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const noAuthController = this.reflector.get<boolean | undefined>(NO_AUTH_METADATA_KEY, context.getClass());
    const noAuthRoute = this.reflector.get<boolean | undefined>(NO_AUTH_METADATA_KEY, context.getHandler());

    const requiresRoleController = this.reflector.get<UserRoleId[] | undefined>(
      ALLOWED_ROLES_METADATA_KEY,
      context.getClass()
    );
    const requiresRoleRoute = this.reflector.get<UserRoleId[] | undefined>(
      ALLOWED_ROLES_METADATA_KEY,
      context.getHandler()
    );

    if (noAuthController || noAuthRoute) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const resolved = await this.sessionService.resolve(req.headers.authorization);

    if (resolved === null) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const user = resolved.user;
    req.user = user;

    if (user.mustChangePassword && !this.allowedDuringSetup(context)) {
      throw new ForbiddenException(SETUP_REQUIRED_MESSAGE);
    }

    const userRoleIds = (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId);

    // Check our controller roles - if set
    if (requiresRoleController && intersection(requiresRoleController, userRoleIds).length === 0) {
      throw new UnauthorizedException(NOT_ALLOWED_MESSAGE);
    }

    // Check our route roles - if set
    if (requiresRoleRoute && intersection(requiresRoleRoute, userRoleIds).length === 0) {
      throw new UnauthorizedException(NOT_ALLOWED_MESSAGE);
    }

    return true;
  }

  private allowedDuringSetup(context: ExecutionContext): boolean {
    return this.reflector.get<boolean | undefined>(ALLOWED_DURING_SETUP_METADATA_KEY, context.getHandler()) === true;
  }
}
