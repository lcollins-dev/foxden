import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateUserRequestDto, UserListStatus, UserRoleId } from '@libs/dto';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { UserAdminService } from '@/api/v1/user/user-admin.service';
import { UserService } from '@/core/user/user.service';

import {
  OWN_ACCOUNT_MESSAGE,
  OWN_PASSWORD_RESET_MESSAGE,
  OWN_PROFILE_MESSAGE,
  UserAdminController,
} from '@/api/v1/user/user-admin.controller';

const buildUpdateUserDto = (overrides: Partial<UpdateUserRequestDto> = {}): UpdateUserRequestDto => ({
  name: 'Tester',
  email: 'tester@example.com',
  userRoleIds: [],
  ...overrides,
});

const buildCaller = (): User => {
  const caller = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Admin',
    email: 'admin@example.com',
    locale: null,
    kA: 'aa',
    credentials: { authSalt: 'bb', verifyHash: 'cc', wrapWrapKb: 'dd', clientSalt: 'ee' },
    now: 1759230000000,
  });
  caller.id = 1;
  caller.userUserRoles = [new UserUserRole(1, UserRoleId.USER_ADMIN), new UserUserRole(1, UserRoleId.SYSTEM_ADMIN)];

  return caller;
};

const ownAccountRefusal = new BadRequestException(OWN_ACCOUNT_MESSAGE);
const ownProfileRefusal = new BadRequestException(OWN_PROFILE_MESSAGE);

describe('UserAdminController', () => {
  let controller: UserAdminController;
  let updateAccountMock: ReturnType<typeof vi.fn>;
  let invalidateSessionsMock: ReturnType<typeof vi.fn>;
  let getUserStatsMock: ReturnType<typeof vi.fn>;
  let getUserListMock: ReturnType<typeof vi.fn>;
  let getUserMock: ReturnType<typeof vi.fn>;
  let updateStateMock: ReturnType<typeof vi.fn>;
  let deleteAccountMock: ReturnType<typeof vi.fn>;
  let createPasswordResetMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateAccountMock = vi.fn().mockResolvedValue(undefined);
    invalidateSessionsMock = vi.fn().mockResolvedValue(undefined);
    getUserStatsMock = vi.fn();
    getUserListMock = vi.fn();
    getUserMock = vi.fn();
    updateStateMock = vi.fn().mockResolvedValue(undefined);
    deleteAccountMock = vi.fn().mockResolvedValue(undefined);
    createPasswordResetMock = vi.fn().mockResolvedValue({ link: 'link', expiresAt: '2026-10-03T09:00:00.000Z' });

    const moduleRef = await Test.createTestingModule({
      controllers: [UserAdminController],
      providers: [
        {
          provide: UserService,
          useValue: {
            updateAccount: updateAccountMock,
            invalidateSessions: invalidateSessionsMock,
            deleteAccount: deleteAccountMock,
          },
        },
        {
          provide: UserAdminService,
          useValue: {
            getUserStats: getUserStatsMock,
            getUserList: getUserListMock,
            getUser: getUserMock,
            updateState: updateStateMock,
            createPasswordReset: createPasswordResetMock,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(UserAdminController);
  });

  it('returns the user stats from the service', async () => {
    getUserStatsMock.mockResolvedValue({ total: 3, enabled: 2, disabled: 1 });

    await expect(controller.getUserStats()).resolves.toEqual({ total: 3, enabled: 2, disabled: 1 });
  });

  it('passes the filter body and the page number through to the list', async () => {
    getUserListMock.mockResolvedValue({ userList: [], pages: 0, total: 0 });

    const dto = { status: UserListStatus.ALL };

    await controller.getUserList(dto, 2);

    expect(getUserListMock).toHaveBeenCalledWith(dto, 2);
  });

  describe('updateUser', () => {
    it('updates the profile and the roles of the addressed user', async () => {
      await controller.updateUser(buildCaller(), 7, buildUpdateUserDto({ userRoleIds: [UserRoleId.SYSTEM_ADMIN] }));

      expect(updateAccountMock).toHaveBeenCalledWith('Tester', 'tester@example.com', [UserRoleId.SYSTEM_ADMIN], 7);
    });

    it('lets the caller send their own account unchanged, the roles in any order', async () => {
      await controller.updateUser(
        buildCaller(),
        1,
        buildUpdateUserDto({
          name: 'Admin',
          email: 'admin@example.com',
          userRoleIds: [UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN],
        })
      );

      expect(updateAccountMock).toHaveBeenCalledWith(
        'Admin',
        'admin@example.com',
        [UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN],
        1
      );
    });

    it.each([
      ['name', { name: 'Renamed Admin', email: 'admin@example.com' }],
      ['email', { name: 'Admin', email: 'other@example.com' }],
    ])('refuses to change the caller own %s', async (_field, profile) => {
      await expect(
        controller.updateUser(
          buildCaller(),
          1,
          buildUpdateUserDto({ ...profile, userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN] })
        )
      ).rejects.toThrow(ownProfileRefusal);

      expect(updateAccountMock).not.toHaveBeenCalled();
    });

    it('refuses to change the caller own roles', async () => {
      await expect(
        controller.updateUser(buildCaller(), 1, buildUpdateUserDto({ userRoleIds: [UserRoleId.USER_ADMIN] }))
      ).rejects.toThrow(ownAccountRefusal);

      expect(updateAccountMock).not.toHaveBeenCalled();
    });
  });

  describe('updateState', () => {
    it('unwraps the enabled flag from the body', async () => {
      const dto = { enabled: false };

      await controller.updateState(buildCaller(), 7, dto);

      expect(updateStateMock).toHaveBeenCalledWith(false, 7);
    });

    it('signs the user out everywhere when disabling', async () => {
      const dto = { enabled: false };

      await controller.updateState(buildCaller(), 7, dto);

      expect(invalidateSessionsMock).toHaveBeenCalledWith(7);
    });

    it('refuses to disable the caller own account', async () => {
      const dto = { enabled: false };

      await expect(controller.updateState(buildCaller(), 1, dto)).rejects.toThrow(ownAccountRefusal);

      expect(updateStateMock).not.toHaveBeenCalled();
      expect(invalidateSessionsMock).not.toHaveBeenCalled();
    });

    it('leaves sessions alone when enabling', async () => {
      const dto = { enabled: true };

      await controller.updateState(buildCaller(), 7, dto);

      expect(invalidateSessionsMock).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('passes the parsed id through', async () => {
      getUserMock.mockResolvedValue({ id: 7 });

      await controller.getUser(7);

      expect(getUserMock).toHaveBeenCalledWith(7);
    });
  });

  describe('deleteUser', () => {
    it('deletes the addressed account', async () => {
      await controller.deleteUser(buildCaller(), 7);

      expect(deleteAccountMock).toHaveBeenCalledWith(7);
    });

    it('refuses to delete the caller own account', async () => {
      await expect(controller.deleteUser(buildCaller(), 1)).rejects.toThrow(ownAccountRefusal);

      expect(deleteAccountMock).not.toHaveBeenCalled();
    });
  });

  describe('password reset', () => {
    it('refuses a reset link for the caller own account', async () => {
      await expect(controller.createPasswordReset(buildCaller(), 1)).rejects.toThrow(
        new BadRequestException(OWN_PASSWORD_RESET_MESSAGE)
      );

      expect(createPasswordResetMock).not.toHaveBeenCalled();
    });
  });
});
