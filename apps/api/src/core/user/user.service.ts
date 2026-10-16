import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { UserRoleId } from '@libs/dto';

import { UserRole } from './entities/user-role.entity';
import { UserUserRole } from './entities/user-user-role.entity';
import { User } from './entities/user.entity';

import { OauthService } from '@/core/oauth/oauth.service';
import { SessionService } from '@/core/session/session.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';

import { checkAuthPw } from './onepw';
import { ValidationException } from '@/common/exceptions/validation.exception';

const USER_MISSING_MESSAGE = "This user doesn't exist";
export const EMAIL_TAKEN_MESSAGE = 'Another account already uses this email.';
export const INCORRECT_PASSWORD_MESSAGE = "That isn't your current password.";
export const LAST_ADMIN_MESSAGE = 'Make another enabled account a user admin first.';

const ADMIN_ROLE_IDS = [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN];

export interface IUserCriteria {
  search?: string;
  enabled?: boolean;
  /** True for accounts holding either admin role, false for accounts holding neither. */
  admin?: boolean;
}

export interface IUserCounts {
  total: number;
  enabled: number;
}

@Injectable()
export class UserService {
  constructor(
    private readonly oauthService: OauthService,
    private readonly sessionService: SessionService,
    private readonly tokenserverService: TokenserverService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(UserUserRole)
    private readonly userUserRoleRepository: Repository<UserUserRole>
  ) {}

  /** Ordered by name, each user carrying its roles. */
  findAndCount(criteria: IUserCriteria, skip: number, take: number): Promise<[User[], number]> {
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userUserRoles', 'userUserRole');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere('(LOWER(user.name) LIKE LOWER(:search) OR LOWER(user.email) LIKE LOWER(:search))', {
        search: `%${criteria.search}%`,
      });
    }

    if (criteria.enabled !== undefined) {
      queryBuilder.andWhere('user.enabled = :enabled', { enabled: criteria.enabled });
    }

    if (criteria.admin !== undefined) {
      const adminRole =
        'EXISTS (SELECT 1 FROM user_user_role adminRole WHERE adminRole.userId = user.id ' +
        'AND adminRole.userRoleId IN (:...adminRoleIds))';

      queryBuilder.andWhere(criteria.admin ? adminRole : `NOT ${adminRole}`, { adminRoleIds: ADMIN_ROLE_IDS });
    }

    return queryBuilder.orderBy('user.name', 'ASC').take(take).skip(skip).getManyAndCount();
  }

  async countByState(): Promise<IUserCounts> {
    const total = await this.userRepository.count();
    const enabled = await this.userRepository.count({ where: { enabled: true } });

    return { total, enabled };
  }

  /** The roles come back only where they were asked for. */
  async findWithThrow(userId: number, withRoles = false): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: withRoles ? { userUserRoles: true } : {},
    });

    if (!user) {
      throw new BadRequestException(USER_MISSING_MESSAGE);
    }

    return user;
  }

  @Transactional()
  async setEnabled(userId: number, enabled: boolean): Promise<void> {
    await this.findWithThrow(userId);

    if (!enabled) {
      await this.requireAnotherAdmin(userId);
    }

    await this.userRepository.update({ id: userId }, { enabled });
  }

  @Transactional()
  async updateRoles(userRoleIds: UserRoleId[], userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException("User doesn't exist");
    }

    if (!userRoleIds.includes(UserRoleId.USER_ADMIN)) {
      await this.requireAnotherAdmin(userId);
    }

    await this.userUserRoleRepository.delete({ userId });

    const userRoles = await this.userRoleRepository.find({ where: { id: In(userRoleIds) } });

    if (userRoles.length < userRoleIds.length) {
      throw new BadRequestException('Invalid role(s) specified');
    }

    for (const userRoleId of userRoleIds) {
      const userUserRole = new UserUserRole(user.id, userRoleId);
      await this.userUserRoleRepository.insert(userUserRole);
    }
  }

  /** Changes the name, address and roles together, so a refused role change leaves the profile as it was. */
  @Transactional()
  async updateAccount(name: string, email: string, userRoleIds: UserRoleId[], userId: number): Promise<void> {
    await this.updateProfile(name, email, userId);
    await this.updateRoles(userRoleIds, userId);
  }

  /** Changes the name and address, as an admin may without the password. */
  @Transactional()
  async updateProfile(name: string, email: string, userId: number): Promise<void> {
    const freeEmail = await this.findFreeEmail(email, userId);

    await this.userRepository.update({ id: userId }, { name, ...freeEmail });
  }

  async updateName(name: string, userId: number): Promise<void> {
    await this.findWithThrow(userId);

    await this.userRepository.update({ id: userId }, { name });
  }

  /**
   * Changes the address once the current password is proven. The v2 password salt does not include the address, so
   * keys and credentials are unaffected.
   */
  async changeEmail(email: string, authPw: string, userId: number): Promise<void> {
    const user = await this.findWithThrow(userId);

    // scrypt runs outside the transaction updateEmail opens.
    if ((await checkAuthPw(authPw, user)) === null) {
      throw new ValidationException('authPw', INCORRECT_PASSWORD_MESSAGE);
    }

    await this.updateEmail(email, userId);
  }

  /** Signs every browser and web session of the account out and revokes its OAuth tokens. */
  async invalidateSessions(userId: number): Promise<void> {
    await this.sessionService.destroyAllSessions(userId);
    await this.oauthService.revokeAllForUser(userId);
  }

  /** Signs out every other session of the account and revokes its OAuth tokens; answers how many sessions went. */
  async signOutOtherSessions(userId: number, keptSessionId: number): Promise<number> {
    const signedOut = await this.sessionService.destroyOtherSessions(userId, keptSessionId);
    await this.oauthService.revokeAllForUser(userId);

    return signedOut;
  }

  /**
   * Retires the account's tokenserver rows and wipes its storage first, then deletes the account with everything that
   * hangs off it, in one transaction the tokenserver write nests in, so a refusal leaves the storage too.
   */
  @Transactional()
  async deleteAccount(userId: number): Promise<void> {
    const user = await this.findWithThrow(userId);

    await this.requireAnotherAdmin(user.id);
    await this.tokenserverService.retireAccount(user.uid);
    await this.deleteUserRows(user.id);
  }

  /** Sessions, devices, tokens and authorization codes cascade; roles do not. */
  private async deleteUserRows(userId: number): Promise<void> {
    await this.userUserRoleRepository.delete({ userId });
    await this.userRepository.delete({ id: userId });
  }

  /**
   * Refuses to take the user-admin role, the account or its sign-in from a holder of that role when no other enabled
   * account holds it. Called inside the change's transaction, so two admins demoting each other cannot both succeed.
   */
  private async requireAnotherAdmin(userId: number): Promise<void> {
    const holdsRole = await this.userUserRoleRepository.exists({
      where: { userId, userRoleId: UserRoleId.USER_ADMIN },
    });

    if (!holdsRole) {
      return;
    }

    const others = await this.userUserRoleRepository.count({
      where: { userId: Not(userId), userRoleId: UserRoleId.USER_ADMIN, user: { enabled: true } },
    });

    if (others === 0) {
      throw new BadRequestException(LAST_ADMIN_MESSAGE);
    }
  }

  @Transactional()
  private async updateEmail(email: string, userId: number): Promise<void> {
    await this.userRepository.update({ id: userId }, await this.findFreeEmail(email, userId));
  }

  /** The trimmed address and its lowercased form, once no other account uses it. */
  private async findFreeEmail(email: string, userId: number): Promise<{ email: string; normalizedEmail: string }> {
    const trimmed = email.trim();

    await this.findWithThrow(userId);

    const emailUser = await this.userRepository.findOne({
      where: { normalizedEmail: trimmed.toLowerCase(), id: Not(userId) },
    });

    if (emailUser) {
      throw new ValidationException('email', EMAIL_TAKEN_MESSAGE);
    }

    return { email: trimmed, normalizedEmail: trimmed.toLowerCase() };
  }
}
