import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';

import { UserUserRole } from './entities/user-user-role.entity';
import { User } from './entities/user.entity';

import { UserService } from './user.service';

import { clientSignUp } from './client-sign-up';
import { createCredentials } from './onepw';
import { randomHex } from '@/common/secret-token';

/**
 * Creates the default admin on start while no account holds the user-admin role, and warns on every start while an
 * account still has to change the default password. Fixed, documented credentials let an operator set a fresh server
 * up from the web app, with no log to read and no shell in the container.
 */
@Injectable()
export class DefaultAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefaultAdminService.name);

  constructor(
    private readonly userService: UserService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserUserRole)
    private readonly userUserRoleRepository: Repository<UserUserRole>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.createIfNoAdmin();
    await this.warnWhileDefaultPasswordRemains();
  }

  private async createIfNoAdmin(): Promise<void> {
    const admins = await this.userUserRoleRepository.count({ where: { userRoleId: UserRoleId.USER_ADMIN } });

    if (admins > 0) {
      return;
    }

    const taken = await this.userRepository.count({ where: { normalizedEmail: DEFAULT_ADMIN.email } });

    if (taken > 0) {
      this.logger.error(
        { email: DEFAULT_ADMIN.email },
        'createIfNoAdmin(): No admin exists, and another account holds the default admin address'
      );
      return;
    }

    // Stretching and scrypt run before the transaction, as at sign-up.
    const signUp = await clientSignUp(DEFAULT_ADMIN.password);
    const user = new User({
      uid: randomHex(16),
      name: 'Admin',
      email: DEFAULT_ADMIN.email,
      locale: null,
      kA: randomHex(32),
      credentials: await createCredentials(signUp.authPw, signUp.wrapKb, signUp.clientSalt),
      now: Date.now(),
      mustChangePassword: true,
    });

    await this.insertAdmin(user);

    this.logger.warn({ email: DEFAULT_ADMIN.email }, 'createIfNoAdmin(): Created the default admin account');
  }

  private async warnWhileDefaultPasswordRemains(): Promise<void> {
    const pending = await this.userRepository.find({ where: { mustChangePassword: true } });

    for (const user of pending) {
      this.logger.warn(
        { email: user.email },
        'warnWhileDefaultPasswordRemains(): The default admin still has the default password - sign in to the web app ' +
          'and change it now'
      );
    }
  }

  @Transactional()
  private async insertAdmin(user: User): Promise<void> {
    await this.userRepository.insert(user);
    await this.userService.updateRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], user.id);
  }
}
