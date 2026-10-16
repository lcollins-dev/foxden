import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { ALLOWED_ROLES_METADATA_KEY } from '@/api/v1/user/decorators/allowed-roles.decorator';
import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';
import { AuthGuard } from '@/api/v1/user/guards/auth.guard';
import {
  ALLOWED_DURING_SETUP_METADATA_KEY,
  NOT_ALLOWED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SETUP_REQUIRED_MESSAGE,
} from '@/api/v1/user/guards/auth.guard';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { SessionService } from '@/core/session/session.service';

interface IMockRequest {
  headers: Record<string, string | undefined>;
  user?: User;
}

const buildUserWithRoles = (roleIds: UserRoleId[]): User => {
  const user = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Tester',
    email: 'tester@example.com',
    locale: null,
    kA: 'aa',
    credentials: { authSalt: 'bb', verifyHash: 'cc', wrapWrapKb: 'dd', clientSalt: 'ee' },
    now: 1759230000000,
  });

  user.userUserRoles = roleIds.map((roleId, index) => {
    const userUserRole = new UserUserRole(1, roleId);
    userUserRole.id = index + 1;
    return userUserRole;
  });

  return user;
};

const resolved = (user: User) => ({ session: { id: 1, userId: 1 }, user });

const buildContext = (request: IMockRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: vi.fn(),
      getNext: vi.fn(),
    }),
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: vi.fn(),
  }) as unknown as ExecutionContext;

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let reflectorGet: ReturnType<typeof vi.fn>;
  let resolveMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    reflectorGet = vi.fn();
    resolveMock = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: Reflector,
          useValue: { get: reflectorGet },
        },
        {
          provide: SessionService,
          useValue: { resolve: resolveMock },
        },
      ],
    }).compile();

    guard = moduleRef.get(AuthGuard);
  });

  describe('no-auth bypass', () => {
    it('returns true when no-auth is set on the controller', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === NO_AUTH_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return true;
        }

        return undefined;
      });

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(resolveMock).not.toHaveBeenCalled();
    });

    it('returns true when no-auth is set on the route handler', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === NO_AUTH_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return true;
        }

        return undefined;
      });

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(resolveMock).not.toHaveBeenCalled();
    });
  });

  describe('missing auth header', () => {
    it('throws when the session does not resolve', async () => {
      reflectorGet.mockReturnValue(undefined);
      resolveMock.mockResolvedValue(null);

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException(SESSION_EXPIRED_MESSAGE));
    });
  });

  describe('role checking', () => {
    it('returns true when the user holds a controller-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return [UserRoleId.USER_ADMIN];
        }

        return undefined;
      });
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([UserRoleId.USER_ADMIN])));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(resolveMock).toHaveBeenCalledWith('Bearer abc');
    });

    it('throws when the user does not hold any controller-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return [UserRoleId.SYSTEM_ADMIN];
        }

        return undefined;
      });
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([UserRoleId.USER_ADMIN])));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException(NOT_ALLOWED_MESSAGE));
    });

    it('returns true when the user holds a route-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return [UserRoleId.USER_ADMIN];
        }

        return undefined;
      });
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN])));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('throws when the user does not hold any route-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return [UserRoleId.SYSTEM_ADMIN];
        }

        return undefined;
      });
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([UserRoleId.USER_ADMIN])));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException(NOT_ALLOWED_MESSAGE));
    });

    it('returns true when no role requirements are set', async () => {
      reflectorGet.mockReturnValue(undefined);
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([])));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('session resolution', () => {
    it('passes the whole authorization header to the session service', async () => {
      reflectorGet.mockReturnValue(undefined);
      resolveMock.mockResolvedValue(resolved(buildUserWithRoles([])));

      const context = buildContext({ headers: { authorization: 'Bearer fxs_abc' } });

      await guard.canActivate(context);

      expect(resolveMock).toHaveBeenCalledWith('Bearer fxs_abc');
    });

    it('attaches the resolved user to the request', async () => {
      reflectorGet.mockReturnValue(undefined);

      const resolvedUser = buildUserWithRoles([UserRoleId.USER_ADMIN]);
      resolveMock.mockResolvedValue(resolved(resolvedUser));

      const request: IMockRequest = { headers: { authorization: 'Bearer abc' } };
      const context = buildContext(request);

      await guard.canActivate(context);

      expect(request.user).toBe(resolvedUser);
    });
  });

  describe('first-time setup', () => {
    const flaggedAdmin = () => {
      const user = buildUserWithRoles([UserRoleId.USER_ADMIN]);
      user.mustChangePassword = true;
      return user;
    };

    it('refuses an account held to setup on a route setup does not need, whatever its roles', async () => {
      reflectorGet.mockReturnValue(undefined);
      resolveMock.mockResolvedValue(resolved(flaggedAdmin()));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).rejects.toThrow(new ForbiddenException(SETUP_REQUIRED_MESSAGE));
    });

    it('lets an account held to setup through on a route marked for setup', async () => {
      reflectorGet.mockImplementation((key: string) => (key === ALLOWED_DURING_SETUP_METADATA_KEY ? true : undefined));
      resolveMock.mockResolvedValue(resolved(flaggedAdmin()));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
