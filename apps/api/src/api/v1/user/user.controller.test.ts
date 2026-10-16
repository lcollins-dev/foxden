import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { Device } from '@/core/device/entities/device.entity';
import { Session } from '@/core/session/entities/session.entity';
import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { DeviceService } from '@/core/device/device.service';
import { SessionService } from '@/core/session/session.service';
import { UserService } from '@/core/user/user.service';

import { UserController } from '@/api/v1/user/user.controller';

const buildUser = (): User => {
  const user = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Tester',
    email: 'tester@example.com',
    locale: null,
    kA: 'aa',
    credentials: { authSalt: 'bb', verifyHash: 'cc', wrapWrapKb: 'dd', clientSalt: 'ee' },
    now: 1759230000000,
  });
  user.id = 7;

  return user;
};

const buildSession = (id: number, createdAt: number, userAgent: string | null = null): Session => {
  const session = new Session({ tokenIdHash: `hash-${id}`, userId: 7, userAgent, now: createdAt });
  session.id = id;
  session.lastAccessAt = createdAt + 60_000;

  return session;
};

describe('UserController', () => {
  let controller: UserController;
  let updateNameMock: ReturnType<typeof vi.fn>;
  let changeEmailMock: ReturnType<typeof vi.fn>;
  let resolveMock: ReturnType<typeof vi.fn>;
  let destroySessionMock: ReturnType<typeof vi.fn>;
  let listSessionsNewestFirstMock: ReturnType<typeof vi.fn>;
  let destroyOwnSessionMock: ReturnType<typeof vi.fn>;
  let findForUserMock: ReturnType<typeof vi.fn>;
  let signOutOtherSessionsMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateNameMock = vi.fn().mockResolvedValue(undefined);
    changeEmailMock = vi.fn().mockResolvedValue(undefined);
    resolveMock = vi.fn();
    destroySessionMock = vi.fn().mockResolvedValue(undefined);
    listSessionsNewestFirstMock = vi.fn().mockResolvedValue([]);
    destroyOwnSessionMock = vi.fn().mockResolvedValue(true);
    findForUserMock = vi.fn().mockResolvedValue([]);
    signOutOtherSessionsMock = vi.fn().mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            updateName: updateNameMock,
            changeEmail: changeEmailMock,
            signOutOtherSessions: signOutOtherSessionsMock,
          },
        },
        {
          provide: SessionService,
          useValue: {
            resolve: resolveMock,
            destroySession: destroySessionMock,
            listSessionsNewestFirst: listSessionsNewestFirstMock,
            destroyOwnSession: destroyOwnSessionMock,
          },
        },
        { provide: DeviceService, useValue: { findForUser: findForUserMock } },
      ],
    }).compile();

    controller = moduleRef.get(UserController);
  });

  describe('updateProfile', () => {
    it('renames the caller', async () => {
      const dto = { name: 'New Name' };

      await controller.updateProfile(buildUser(), dto);

      expect(updateNameMock).toHaveBeenCalledWith('New Name', 7);
    });
  });

  describe('changeEmail', () => {
    it('hands the address and the password proof to core for the caller', async () => {
      const dto = { email: 'new@example.com', authPw: 'a'.repeat(64) };

      await controller.changeEmail(buildUser(), dto);

      expect(changeEmailMock).toHaveBeenCalledWith('new@example.com', 'a'.repeat(64), 7);
    });
  });

  describe('logout', () => {
    it('destroys the session the authorization header resolves to', async () => {
      resolveMock.mockResolvedValue({ session: { id: 11 }, user: buildUser() });

      await controller.doLogout('Bearer fxs_abc');

      expect(resolveMock).toHaveBeenCalledWith('Bearer fxs_abc');
      expect(destroySessionMock).toHaveBeenCalledWith(11);
    });

    it('does nothing when the header resolves to no session', async () => {
      resolveMock.mockResolvedValue(null);

      await controller.doLogout(undefined);

      expect(destroySessionMock).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('maps user role ids from userRoleId (not the junction-table id)', () => {
      const user = buildUser();

      const adminRole = new UserUserRole(7, UserRoleId.USER_ADMIN);
      adminRole.id = 501;
      const systemRole = new UserUserRole(7, UserRoleId.SYSTEM_ADMIN);
      systemRole.id = 502;

      user.userUserRoles = [adminRole, systemRole];

      expect(controller.getProfile(user)).toEqual({
        uid: '0123456789abcdef0123456789abcdef',
        name: 'Tester',
        email: 'tester@example.com',
        userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
        mustChangePassword: false,
      });
    });

    it('returns an empty role list when the user has no roles', () => {
      const user = buildUser();
      user.userUserRoles = [];

      expect(controller.getProfile(user).userRoleIds).toEqual([]);
    });
  });

  describe('getSessionList', () => {
    it('lists the caller sessions with their devices and marks the calling one', async () => {
      const web = buildSession(12, Date.parse('2026-09-30T10:00:00Z'), 'Mozilla/5.0');
      const firefox = buildSession(11, Date.parse('2026-09-29T10:00:00Z'));
      const device = new Device({ id: 'd'.repeat(32), userId: 7, sessionId: 11, now: 0 });
      device.name = "Sam's Firefox";
      device.type = 'mobile';
      const detached = new Device({ id: 'e'.repeat(32), userId: 7, sessionId: 99, now: 0 });
      detached.sessionId = null;

      resolveMock.mockResolvedValue({ session: web, user: buildUser() });
      listSessionsNewestFirstMock.mockResolvedValue([web, firefox]);
      findForUserMock.mockResolvedValue([detached, device]);

      const response = await controller.getSessionList(buildUser(), 'Bearer fxs_abc');

      expect(listSessionsNewestFirstMock).toHaveBeenCalledWith(7);
      expect(findForUserMock).toHaveBeenCalledWith(7);
      expect(response).toEqual({
        sessionList: [
          {
            id: 12,
            device: null,
            userAgent: 'Mozilla/5.0',
            createdAt: '2026-09-30T10:00:00.000Z',
            lastAccessAt: '2026-09-30T10:01:00.000Z',
            current: true,
          },
          {
            id: 11,
            device: { name: "Sam's Firefox", type: 'mobile' },
            userAgent: null,
            createdAt: '2026-09-29T10:00:00.000Z',
            lastAccessAt: '2026-09-29T10:01:00.000Z',
            current: false,
          },
        ],
      });
    });

    it('refuses when the calling session ended meanwhile', async () => {
      resolveMock.mockResolvedValue(null);

      await expect(controller.getSessionList(buildUser(), 'Bearer fxs_abc')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('deleteSession', () => {
    it('signs out one of the caller sessions', async () => {
      await controller.deleteSession(buildUser(), 11);

      expect(destroyOwnSessionMock).toHaveBeenCalledWith(7, 11);
    });

    it('answers 404 for a session that is not the caller one', async () => {
      destroyOwnSessionMock.mockResolvedValue(false);

      await expect(controller.deleteSession(buildUser(), 11)).rejects.toThrow(NotFoundException);
    });
  });

  describe('signOutOthers', () => {
    it('keeps the calling session and reports how many were signed out', async () => {
      resolveMock.mockResolvedValue({ session: { id: 12 }, user: buildUser() });
      signOutOtherSessionsMock.mockResolvedValue(3);

      expect(await controller.signOutOthers(buildUser(), 'Bearer fxs_abc')).toEqual({ signedOut: 3 });
      expect(signOutOtherSessionsMock).toHaveBeenCalledWith(7, 12);
    });
  });
});
