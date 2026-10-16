import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserListRole, UserListStatus, UserRoleId } from '@libs/dto';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';
import { PasswordReset } from '@/core/user/password-reset/entities/password-reset.entity';

import { PASSWORD_RESET_DISABLED_MESSAGE, UserAdminService } from '@/api/v1/user/user-admin.service';
import { ConfigService } from '@/config/config.service';
import { SessionService } from '@/core/session/session.service';
import { PasswordResetService } from '@/core/user/password-reset/password-reset.service';
import { UserService } from '@/core/user/user.service';

const PAGE_SIZE = 10;

const buildUser = (overrides: Partial<User> = {}): User => {
  const user = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Tester',
    email: 'tester@example.com',
    locale: null,
    kA: 'aa',
    credentials: { authSalt: 'bb', verifyHash: 'cc', wrapWrapKb: 'dd', clientSalt: 'ee' },
    now: 1759230000000,
  });

  user.id = 1;
  user.enabled = true;
  user.createdDate = new Date('2026-04-01T09:00:00Z');

  Object.assign(user, overrides);

  return user;
};

describe('UserAdminService', () => {
  let userAdminService: UserAdminService;
  let userService: {
    findAndCount: ReturnType<typeof vi.fn>;
    countByState: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
  };
  let lastAccessByUser: ReturnType<typeof vi.fn>;
  let passwordResetService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    userService = {
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      countByState: vi.fn().mockResolvedValue({ total: 0, enabled: 0 }),
      findWithThrow: vi.fn().mockResolvedValue(buildUser()),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    };
    lastAccessByUser = vi.fn().mockResolvedValue(new Map());
    passwordResetService = {
      findPending: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      revoke: vi.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        { provide: UserService, useValue: userService },
        { provide: SessionService, useValue: { lastAccessByUser } },
        { provide: PasswordResetService, useValue: passwordResetService },
      ],
    }).compile();

    userAdminService = moduleRef.get(UserAdminService);
  });

  describe('getUserList', () => {
    it('turns the requested page into an offset and a limit', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ALL }, 3);

      expect(userService.findAndCount).toHaveBeenCalledWith(
        { search: undefined, enabled: undefined, admin: undefined },
        PAGE_SIZE * 2,
        PAGE_SIZE
      );
    });

    it('passes the search term through as criteria', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ALL, search: 'tester' }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith(
        { search: 'tester', enabled: undefined, admin: undefined },
        0,
        PAGE_SIZE
      );
    });

    it('narrows to enabled users alone', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ENABLED }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith(
        { search: undefined, enabled: true, admin: undefined },
        0,
        PAGE_SIZE
      );
    });

    it('narrows to disabled users alone', async () => {
      await userAdminService.getUserList({ status: UserListStatus.DISABLED }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith(
        { search: undefined, enabled: false, admin: undefined },
        0,
        PAGE_SIZE
      );
    });

    it('reads each row down to what a list needs', async () => {
      const user = buildUser();
      user.userUserRoles = [new UserUserRole(user.id, UserRoleId.SYSTEM_ADMIN)];
      userService.findAndCount.mockResolvedValue([[user], 1]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(response.userList).toEqual([
        {
          id: 1,
          name: 'Tester',
          email: 'tester@example.com',
          enabled: true,
          userRoleIds: [UserRoleId.SYSTEM_ADMIN],
          createdDate: '2026-04-01T09:00:00.000Z',
          lastActiveAt: null,
        },
      ]);
    });

    it('keeps the credentials and keys out of the list', async () => {
      userService.findAndCount.mockResolvedValue([[buildUser()], 1]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(Object.keys(response.userList[0])).toEqual([
        'id',
        'name',
        'email',
        'enabled',
        'userRoleIds',
        'createdDate',
        'lastActiveAt',
      ]);
    });

    it('rounds the page count up on a partial last page and reports the total match count', async () => {
      userService.findAndCount.mockResolvedValue([[], 21]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(response.pages).toBe(3);
      expect(response.total).toBe(21);
    });

    it('narrows to admins or to plain users by role', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ALL, role: UserListRole.ADMIN }, 1);
      await userAdminService.getUserList({ status: UserListStatus.ALL, role: UserListRole.USER }, 1);
      await userAdminService.getUserList({ status: UserListStatus.ALL, role: UserListRole.ALL }, 1);

      expect(userService.findAndCount.mock.calls.map(call => (call[0] as { admin?: boolean }).admin)).toEqual([
        true,
        false,
        undefined,
      ]);
    });

    it('reads the newest session access of the listed accounts in one call', async () => {
      userService.findAndCount.mockResolvedValue([[buildUser({ id: 1 }), buildUser({ id: 2 })], 2]);

      await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(lastAccessByUser).toHaveBeenCalledTimes(1);
      expect(lastAccessByUser).toHaveBeenCalledWith([1, 2]);
    });

    it('reports the later of the last sign-in and the newest session use as last active', async () => {
      const signedInLater = buildUser({ id: 1, lastLoginSuccess: new Date('2026-06-02T09:00:00Z') });
      const usedLater = buildUser({ id: 2, lastLoginSuccess: new Date('2026-06-01T09:00:00Z') });
      const sessionOnly = buildUser({ id: 3 });
      const neverUsed = buildUser({ id: 4 });

      userService.findAndCount.mockResolvedValue([[signedInLater, usedLater, sessionOnly, neverUsed], 4]);
      lastAccessByUser.mockResolvedValue(
        new Map([
          [1, Date.parse('2026-06-01T12:00:00Z')],
          [2, Date.parse('2026-06-03T09:00:00Z')],
          [3, Date.parse('2026-06-04T09:00:00Z')],
        ])
      );

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(response.userList.map(user => user.lastActiveAt)).toEqual([
        '2026-06-02T09:00:00.000Z',
        '2026-06-03T09:00:00.000Z',
        '2026-06-04T09:00:00.000Z',
        null,
      ]);
    });
  });

  describe('getUserStats', () => {
    it('reports the disabled count as the remainder', async () => {
      userService.countByState.mockResolvedValue({ total: 10, enabled: 7 });

      const stats = await userAdminService.getUserStats();

      expect(stats).toEqual({ total: 10, enabled: 7, disabled: 3 });
    });
  });

  describe('getUser', () => {
    it('asks for the roles alongside the row', async () => {
      await userAdminService.getUser(1);

      expect(userService.findWithThrow).toHaveBeenCalledWith(1, true);
    });

    it('throws when the user does not exist', async () => {
      userService.findWithThrow.mockRejectedValue(new BadRequestException());

      await expect(userAdminService.getUser(1)).rejects.toThrow(BadRequestException);
    });

    it('serialises the dates as json strings, last active from the newest session use', async () => {
      lastAccessByUser.mockResolvedValue(new Map([[1, Date.parse('2026-05-01T09:00:00Z')]]));

      const user = await userAdminService.getUser(1);

      expect(lastAccessByUser).toHaveBeenCalledWith([1]);
      expect(user.createdDate).toBe('2026-04-01T09:00:00.000Z');
      expect(user.lastActiveAt).toBe('2026-05-01T09:00:00.000Z');
    });

    it('reports a user who has never signed in as never having done so', async () => {
      const user = await userAdminService.getUser(1);

      expect(user.lastLoginSuccess).toBeNull();
      expect(user.lastLoginFail).toBeNull();
    });

    it('carries the uid the profile reports for the same account', async () => {
      const user = await userAdminService.getUser(1);

      expect(user.uid).toBe('0123456789abcdef0123456789abcdef');
    });

    it('reports when a pending reset link expires, or null without one', async () => {
      expect((await userAdminService.getUser(1)).passwordResetExpiresAt).toBeNull();

      passwordResetService.findPending.mockResolvedValue(
        new PasswordReset({ tokenHash: 'x', userId: 1, expiresAt: Date.parse('2026-10-03T09:00:00Z'), now: 0 })
      );

      expect((await userAdminService.getUser(1)).passwordResetExpiresAt).toBe('2026-10-03T09:00:00.000Z');
      expect(passwordResetService.findPending).toHaveBeenCalledWith(1);
    });

    it('keeps the credentials and keys out of the response', async () => {
      const user = await userAdminService.getUser(1);

      expect(user).not.toHaveProperty('verifyHash');
      expect(user).not.toHaveProperty('kA');
    });
  });

  describe('createPasswordReset', () => {
    it('answers the link once with its expiry', async () => {
      passwordResetService.create.mockResolvedValue({
        passwordReset: new PasswordReset({
          tokenHash: 'x',
          userId: 1,
          expiresAt: Date.parse('2026-10-03T09:00:00Z'),
          now: 0,
        }),
        link: 'https://sync.example/reset-password/token',
      });

      await expect(userAdminService.createPasswordReset(1)).resolves.toEqual({
        link: 'https://sync.example/reset-password/token',
        expiresAt: '2026-10-03T09:00:00.000Z',
      });
      expect(passwordResetService.create).toHaveBeenCalledWith(1);
    });

    it('refuses a disabled account and an unknown one', async () => {
      userService.findWithThrow.mockResolvedValueOnce(buildUser({ enabled: false }));
      await expect(userAdminService.createPasswordReset(1)).rejects.toThrow(
        new BadRequestException(PASSWORD_RESET_DISABLED_MESSAGE)
      );

      userService.findWithThrow.mockRejectedValueOnce(new BadRequestException());
      await expect(userAdminService.createPasswordReset(1)).rejects.toThrow(BadRequestException);

      expect(passwordResetService.create).not.toHaveBeenCalled();
    });
  });

  describe('updateState', () => {
    it('changes state through the domain', async () => {
      await userAdminService.updateState(false, 1);

      expect(userService.setEnabled).toHaveBeenCalledWith(1, false);
    });
  });
});
