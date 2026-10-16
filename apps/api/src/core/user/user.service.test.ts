import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { UserRole } from '@/core/user/entities/user-role.entity';
import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { OauthService } from '@/core/oauth/oauth.service';
import { SessionService } from '@/core/session/session.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';
import {
  EMAIL_TAKEN_MESSAGE,
  INCORRECT_PASSWORD_MESSAGE,
  LAST_ADMIN_MESSAGE,
  UserService,
} from '@/core/user/user.service';

import { ValidationException } from '@/common/exceptions/validation.exception';
import { createCredentials } from '@/core/user/onepw';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

interface IQueryBuilderMock {
  leftJoinAndSelect: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  getManyAndCount: ReturnType<typeof vi.fn>;
}

const makeQueryBuilderMock = (): IQueryBuilderMock => {
  const queryBuilder: Partial<IQueryBuilderMock> = {};

  queryBuilder.leftJoinAndSelect = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.andWhere = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.orderBy = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.take = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.skip = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.getManyAndCount = vi.fn().mockResolvedValue([[], 0]);

  return queryBuilder as IQueryBuilderMock;
};

interface IRepositoryMock {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  createQueryBuilder: ReturnType<typeof vi.fn>;
}

const makeRepoMock = (queryBuilder: IQueryBuilderMock = makeQueryBuilderMock()): IRepositoryMock => ({
  findOne: vi.fn(),
  find: vi.fn(),
  count: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  insert: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
});

const buildUser = (): User => {
  const user = new User({
    uid: '0123456789abcdef0123456789abcdef',
    name: 'Tester',
    email: 'Tester@Example.com',
    locale: null,
    kA: 'aa',
    credentials: { authSalt: 'bb', verifyHash: 'cc', wrapWrapKb: 'dd', clientSalt: 'ee' },
    now: 1759230000000,
  });
  user.id = 1;

  return user;
};

describe('UserService', () => {
  let userService: UserService;
  let queryBuilder: IQueryBuilderMock;
  let userRepository: IRepositoryMock;
  let userRoleRepository: IRepositoryMock;
  let userUserRoleRepository: IRepositoryMock;
  let destroyAllSessionsMock: ReturnType<typeof vi.fn>;
  let destroyOtherSessionsMock: ReturnType<typeof vi.fn>;
  let revokeAllForUserMock: ReturnType<typeof vi.fn>;
  let retireAccountMock: ReturnType<typeof vi.fn>;
  let calls: string[];

  beforeEach(async () => {
    queryBuilder = makeQueryBuilderMock();
    userRepository = makeRepoMock(queryBuilder);
    userRoleRepository = makeRepoMock();
    userUserRoleRepository = makeRepoMock();
    calls = [];
    destroyAllSessionsMock = vi.fn().mockResolvedValue(undefined);
    destroyOtherSessionsMock = vi.fn().mockResolvedValue(2);
    revokeAllForUserMock = vi.fn().mockResolvedValue(undefined);
    retireAccountMock = vi.fn().mockImplementation(() => calls.push('retireAccount'));
    userRepository.delete.mockImplementation(() => calls.push('deleteUser'));

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: SessionService,
          useValue: { destroyAllSessions: destroyAllSessionsMock, destroyOtherSessions: destroyOtherSessionsMock },
        },
        { provide: OauthService, useValue: { revokeAllForUser: revokeAllForUserMock } },
        { provide: TokenserverService, useValue: { retireAccount: retireAccountMock } },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepository },
        { provide: getRepositoryToken(UserUserRole), useValue: userUserRoleRepository },
      ],
    }).compile();

    userService = moduleRef.get(UserService);
  });

  describe('findAndCount', () => {
    it('skips the search clause when no search term is given', async () => {
      await userService.findAndCount({}, 0, 10);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('wraps the search term in wildcards and matches name or email', async () => {
      await userService.findAndCount({ search: 'tester' }, 0, 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('LOWER(user.email)'), {
        search: '%tester%',
      });
    });

    it('filters on the enabled flag when one is given', async () => {
      await userService.findAndCount({ enabled: false }, 0, 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('user.enabled = :enabled', { enabled: false });
    });

    it('narrows to accounts holding either admin role', async () => {
      await userService.findAndCount({ admin: true }, 0, 10);

      const [clause, parameters] = queryBuilder.andWhere.mock.calls[0] as [string, unknown];

      expect(clause).toMatch(/^EXISTS \(SELECT 1 FROM user_user_role /);
      expect(parameters).toEqual({ adminRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN] });
    });

    it('narrows to accounts holding neither admin role', async () => {
      await userService.findAndCount({ admin: false }, 0, 10);

      const [clause] = queryBuilder.andWhere.mock.calls[0] as [string];

      expect(clause).toMatch(/^NOT EXISTS \(SELECT 1 FROM user_user_role /);
    });

    it('orders by name and applies the offset and limit', async () => {
      await userService.findAndCount({}, 20, 10);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    });
  });

  describe('countByState', () => {
    it('counts every user and the enabled ones', async () => {
      userRepository.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7);

      await expect(userService.countByState()).resolves.toEqual({ total: 10, enabled: 7 });
      expect(userRepository.count).toHaveBeenLastCalledWith({ where: { enabled: true } });
    });
  });

  describe('findWithThrow', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.findWithThrow(1)).rejects.toThrow(BadRequestException);
    });

    it('loads the role junction rows only when asked', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());

      await userService.findWithThrow(1, true);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 }, relations: { userUserRoles: true } });
    });
  });

  describe('setEnabled', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.setEnabled(1, false)).rejects.toThrow(BadRequestException);

      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('stores the new enabled flag', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());

      await userService.setEnabled(1, false);

      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, { enabled: false });
    });
  });

  describe('keeping an enabled user admin', () => {
    const lastAdminRefusal = new BadRequestException(LAST_ADMIN_MESSAGE);

    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(buildUser());
      userRoleRepository.find.mockResolvedValue([new UserRole(UserRoleId.SYSTEM_ADMIN, 'System Admin')]);
      userUserRoleRepository.exists.mockResolvedValue(true);
      userUserRoleRepository.count.mockResolvedValue(0);
    });

    it('refuses to disable, demote or delete the last enabled user admin, before wiping any storage', async () => {
      await expect(userService.setEnabled(1, false)).rejects.toThrow(lastAdminRefusal);
      await expect(userService.updateRoles([UserRoleId.SYSTEM_ADMIN], 1)).rejects.toThrow(lastAdminRefusal);
      await expect(userService.deleteAccount(1)).rejects.toThrow(lastAdminRefusal);

      expect(userUserRoleRepository.exists).toHaveBeenCalledWith({
        where: { userId: 1, userRoleId: UserRoleId.USER_ADMIN },
      });
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(userUserRoleRepository.delete).not.toHaveBeenCalled();
      expect(retireAccountMock).not.toHaveBeenCalled();
    });

    it('lets another enabled user admin stand in', async () => {
      userUserRoleRepository.count.mockResolvedValue(1);

      await userService.updateRoles([UserRoleId.SYSTEM_ADMIN], 1);

      expect(userUserRoleRepository.insert).toHaveBeenCalled();
    });

    it('asks nothing of an account without the role, of enabling it, or of a role set that keeps it', async () => {
      userRoleRepository.find.mockResolvedValue([new UserRole(UserRoleId.USER_ADMIN, 'User Admin')]);

      await userService.setEnabled(1, true);
      await userService.updateRoles([UserRoleId.USER_ADMIN], 1);

      expect(userUserRoleRepository.exists).not.toHaveBeenCalled();

      userUserRoleRepository.exists.mockResolvedValue(false);
      await userService.setEnabled(1, false);

      expect(userUserRoleRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.updateProfile('Name', 'a@example.com', 1)).rejects.toThrow(BadRequestException);
    });

    it('checks the lowercased address against every other account', async () => {
      userRepository.findOne.mockResolvedValueOnce(buildUser()).mockResolvedValueOnce(null);

      await userService.updateProfile('Name', ' New@Example.com ', 1);

      expect(userRepository.findOne).toHaveBeenLastCalledWith({
        where: { normalizedEmail: 'new@example.com', id: Not(1) },
      });
    });

    it('throws when another account already uses the address', async () => {
      userRepository.findOne.mockResolvedValueOnce(buildUser()).mockResolvedValueOnce(buildUser());

      await expect(userService.updateProfile('Name', 'taken@example.com', 1)).rejects.toEqual(
        new ValidationException('email', EMAIL_TAKEN_MESSAGE)
      );

      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('stores the address as typed alongside its lowercased form', async () => {
      userRepository.findOne.mockResolvedValueOnce(buildUser()).mockResolvedValueOnce(null);

      await userService.updateProfile('New Name', 'New@Example.com', 1);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        { name: 'New Name', email: 'New@Example.com', normalizedEmail: 'new@example.com' }
      );
    });
  });

  describe('updateName', () => {
    it('stores only the name', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());

      await userService.updateName('New Name', 1);

      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, { name: 'New Name' });
    });
  });

  describe('changeEmail', () => {
    const AUTH_PW = 'a'.repeat(64);

    const userWithPassword = async (): Promise<User> =>
      Object.assign(buildUser(), await createCredentials(AUTH_PW, 'b'.repeat(64), 'salt'));

    it('changes the address once the current authPW matches', async () => {
      userRepository.findOne.mockResolvedValueOnce(await userWithPassword()).mockResolvedValueOnce(buildUser());
      userRepository.findOne.mockResolvedValueOnce(null);

      await userService.changeEmail(' New@Example.com ', AUTH_PW, 1);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        { email: 'New@Example.com', normalizedEmail: 'new@example.com' }
      );
    });

    it('refuses a wrong authPW before looking at the address', async () => {
      userRepository.findOne.mockResolvedValueOnce(await userWithPassword());

      await expect(userService.changeEmail('new@example.com', 'c'.repeat(64), 1)).rejects.toEqual(
        new ValidationException('authPw', INCORRECT_PASSWORD_MESSAGE)
      );

      expect(userRepository.findOne).toHaveBeenCalledTimes(1);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('refuses an address another account uses, in any case', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(await userWithPassword())
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser());

      await expect(userService.changeEmail('TAKEN@example.com', AUTH_PW, 1)).rejects.toEqual(
        new ValidationException('email', EMAIL_TAKEN_MESSAGE)
      );

      expect(userRepository.findOne).toHaveBeenLastCalledWith({
        where: { normalizedEmail: 'taken@example.com', id: Not(1) },
      });
      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateRoles', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.updateRoles([UserRoleId.USER_ADMIN], 1)).rejects.toThrow(BadRequestException);
    });

    it('throws when one or more role ids are not recognised', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      userRoleRepository.find.mockResolvedValue([new UserRole(UserRoleId.USER_ADMIN, 'User Admin')]);

      await expect(userService.updateRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], 1)).rejects.toThrow(
        BadRequestException
      );

      expect(userUserRoleRepository.insert).not.toHaveBeenCalled();
    });

    it('clears existing roles before inserting the new set', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      userRoleRepository.find.mockResolvedValue([
        new UserRole(UserRoleId.USER_ADMIN, 'User Admin'),
        new UserRole(UserRoleId.SYSTEM_ADMIN, 'System Admin'),
      ]);

      await userService.updateRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], 1);

      expect(userUserRoleRepository.delete).toHaveBeenCalledWith({ userId: 1 });
      expect(userUserRoleRepository.insert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ userId: 1, userRoleId: UserRoleId.USER_ADMIN })
      );
      expect(userUserRoleRepository.insert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ userId: 1, userRoleId: UserRoleId.SYSTEM_ADMIN })
      );
    });
  });

  describe('invalidateSessions', () => {
    it('destroys every session and revokes every OAuth token of the user', async () => {
      await userService.invalidateSessions(42);

      expect(destroyAllSessionsMock).toHaveBeenCalledWith(42);
      expect(revokeAllForUserMock).toHaveBeenCalledWith(42);
    });
  });

  describe('signOutOtherSessions', () => {
    it('keeps the calling session, revokes the OAuth tokens and counts the sessions signed out', async () => {
      expect(await userService.signOutOtherSessions(42, 11)).toBe(2);

      expect(destroyOtherSessionsMock).toHaveBeenCalledWith(42, 11);
      expect(revokeAllForUserMock).toHaveBeenCalledWith(42);
    });
  });

  describe('deleteAccount', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.deleteAccount(1)).rejects.toThrow(BadRequestException);

      expect(retireAccountMock).not.toHaveBeenCalled();
      expect(userRepository.delete).not.toHaveBeenCalled();
    });

    it('retires the tokenserver rows before deleting the account and what does not cascade', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());

      await userService.deleteAccount(1);

      expect(retireAccountMock).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
      expect(userUserRoleRepository.delete).toHaveBeenCalledWith({ userId: 1 });
      expect(userRepository.delete).toHaveBeenCalledWith({ id: 1 });
      expect(calls).toEqual(['retireAccount', 'deleteUser']);
    });

    it('leaves the account in place when retiring fails', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      retireAccountMock.mockRejectedValue(new Error('busy'));

      await expect(userService.deleteAccount(1)).rejects.toThrow('busy');

      expect(userRepository.delete).not.toHaveBeenCalled();
    });
  });
});
