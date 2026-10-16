import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ms from 'ms';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { PasswordResetState } from '@libs/dto';

import { PasswordReset } from './entities/password-reset.entity';

import { ConfigService } from '@/config/config.service';

import { publicUrl } from '@/common/public-url';
import { hashToken, randomHex } from '@/common/secret-token';

/** Kept past expiry so the reset page can still say why a link no longer works, as for invites. */
export const PASSWORD_RESET_RETENTION_MS = ms('30d');

export interface ICreatedPasswordReset {
  passwordReset: PasswordReset;
  link: string;
}

export interface IPasswordResetCheck {
  state: PasswordResetState;
  /** Set only for a valid link, with its account. */
  passwordReset: PasswordReset | null;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>
  ) {}

  /** Returns the link, the only place the raw token appears. Replaces the account's pending link. */
  @Transactional()
  async create(userId: number): Promise<ICreatedPasswordReset> {
    const now = Date.now();

    await this.passwordResetRepository.delete({ expiresAt: LessThan(now - PASSWORD_RESET_RETENTION_MS) });
    await this.passwordResetRepository.delete(this.pendingWhere(now, userId));

    const token = randomHex(32);
    const passwordReset = new PasswordReset({
      tokenHash: hashToken(token),
      userId,
      expiresAt: now + ms(this.configService.passwordResetExpiry),
      now,
    });

    await this.passwordResetRepository.insert(passwordReset);

    this.logger.log({ passwordResetId: passwordReset.id, userId }, 'create(): Password reset link created');

    return { passwordReset, link: publicUrl(this.configService, `/reset-password/${token}`) };
  }

  /** A used link reads as used even once it has expired. */
  async check(token: string): Promise<IPasswordResetCheck> {
    const passwordReset = await this.passwordResetRepository.findOne({
      where: { tokenHash: hashToken(token) },
      relations: { user: true },
    });

    if (passwordReset?.user === undefined) {
      return { state: PasswordResetState.INVALID, passwordReset: null };
    }

    if (passwordReset.usedAt !== null) {
      return { state: PasswordResetState.USED, passwordReset: null };
    }

    if (passwordReset.expiresAt <= Date.now()) {
      return { state: PasswordResetState.EXPIRED, passwordReset: null };
    }

    return { state: PasswordResetState.VALID, passwordReset };
  }

  findPending(userId: number): Promise<PasswordReset | null> {
    return this.passwordResetRepository.findOne({ where: this.pendingWhere(Date.now(), userId) });
  }

  /** False when the account has no pending link. */
  async revoke(userId: number): Promise<boolean> {
    const result = await this.passwordResetRepository.delete(this.pendingWhere(Date.now(), userId));

    return (result.affected ?? 0) > 0;
  }

  /** False when the link is no longer pending, so only one reset can use it. */
  async consume(passwordReset: PasswordReset): Promise<boolean> {
    const now = Date.now();
    const result = await this.passwordResetRepository.update(
      { id: passwordReset.id, usedAt: IsNull(), expiresAt: MoreThan(now) },
      { usedAt: now }
    );

    return (result.affected ?? 0) > 0;
  }

  private pendingWhere(now: number, userId: number) {
    return { userId, usedAt: IsNull(), expiresAt: MoreThan(now) };
  }
}
