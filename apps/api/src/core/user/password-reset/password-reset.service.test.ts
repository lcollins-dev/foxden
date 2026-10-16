import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordResetState } from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';
import { PasswordReset } from '@/core/user/password-reset/entities/password-reset.entity';

import { ConfigService } from '@/config/config.service';
import { PASSWORD_RESET_RETENTION_MS, PasswordResetService } from '@/core/user/password-reset/password-reset.service';

import { hashToken } from '@/common/secret-token';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const NOW = 1790000000000;
const TOKEN = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

const buildPasswordReset = (overrides: Partial<PasswordReset> = {}): PasswordReset => {
  const passwordReset = new PasswordReset({ tokenHash: 'x', userId: 7, expiresAt: NOW + 1000, now: 0 });
  passwordReset.id = 3;
  passwordReset.user = Object.create(User.prototype) as User;

  return Object.assign(passwordReset, overrides);
};

describe('PasswordResetService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: PasswordResetService;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    repository = {
      insert: vi.fn(),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn(),
    };

    service = new PasswordResetService(
      { webAppBaseUrl: 'https://sync.example/', passwordResetExpiry: '1d' } as unknown as ConfigService,
      repository as unknown as Repository<PasswordReset>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('stores the hash of a random token for the account, expiring after the configured lifetime', async () => {
      const { passwordReset, link } = await service.create(7);
      const token = link.replace('https://sync.example/reset-password/', '');

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(passwordReset).toMatchObject({
        tokenHash: hashToken(token),
        userId: 7,
        expiresAt: NOW + DAY_MS,
        createdAt: NOW,
        usedAt: null,
      });
      expect(repository.insert).toHaveBeenCalledWith(passwordReset);
    });

    it('replaces the account pending link and purges links 30 days past expiry before inserting', async () => {
      await service.create(7);

      expect(repository.delete).toHaveBeenCalledWith({ expiresAt: LessThan(NOW - PASSWORD_RESET_RETENTION_MS) });
      expect(repository.delete).toHaveBeenCalledWith({ userId: 7, usedAt: IsNull(), expiresAt: MoreThan(NOW) });
      expect(repository.delete.mock.invocationCallOrder[1]).toBeLessThan(repository.insert.mock.invocationCallOrder[0]);
    });

    it('makes a different token every time', async () => {
      const first = await service.create(7);
      const second = await service.create(7);

      expect(first.link).not.toBe(second.link);
    });
  });

  describe('check', () => {
    it('looks the link up by the hash of its token, with its account', async () => {
      const passwordReset = buildPasswordReset();
      repository.findOne.mockResolvedValue(passwordReset);

      expect(await service.check(TOKEN)).toEqual({ state: PasswordResetState.VALID, passwordReset });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { tokenHash: hashToken(TOKEN) },
        relations: { user: true },
      });
    });

    it('reads an unknown link as invalid', async () => {
      repository.findOne.mockResolvedValue(null);

      expect(await service.check(TOKEN)).toEqual({ state: PasswordResetState.INVALID, passwordReset: null });
    });

    it('reads a used link as used, even once it has expired', async () => {
      repository.findOne.mockResolvedValue(buildPasswordReset({ usedAt: NOW - 5, expiresAt: NOW - 1 }));

      expect(await service.check(TOKEN)).toEqual({ state: PasswordResetState.USED, passwordReset: null });
    });

    it('reads a link as expired from the moment it expires', async () => {
      repository.findOne.mockResolvedValue(buildPasswordReset({ expiresAt: NOW }));

      expect(await service.check(TOKEN)).toEqual({ state: PasswordResetState.EXPIRED, passwordReset: null });
    });
  });
});
