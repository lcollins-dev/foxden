import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordResetState } from '@libs/dto';

import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { User } from '@/core/user/entities/user.entity';
import { PasswordReset } from '@/core/user/password-reset/entities/password-reset.entity';

import { AccountService } from '@/core/user/account.service';
import { PasswordResetService } from '@/core/user/password-reset/password-reset.service';

import {
  PASSWORD_RESET_ACCOUNT_DISABLED_MESSAGE,
  PASSWORD_RESET_INVALID_MESSAGE,
  PasswordResetController,
} from '@/api/v1/user/password-reset/password-reset.controller';

import { PasswordResetRefusal, PasswordResetRefusedError } from '@/core/user/password-reset/password-reset-refusal';

const TOKEN = 'a'.repeat(64);

describe('PasswordResetController', () => {
  let check: ReturnType<typeof vi.fn>;
  let resetPassword: ReturnType<typeof vi.fn>;
  let controller: PasswordResetController;

  const credentials = {
    token: TOKEN,
    authPw: 'b'.repeat(64),
    clientSalt: `identity.mozilla.com/picl/v1/quickStretchV2:${'c'.repeat(32)}`,
  };
  const request = { get: () => 'Firefox' } as unknown as Request;

  beforeEach(() => {
    check = vi.fn();
    resetPassword = vi.fn();
    controller = new PasswordResetController(
      { resetPassword } as unknown as AccountService,
      { check } as unknown as PasswordResetService
    );
  });

  it('answers a valid link with the account address and the expiry', async () => {
    const passwordReset = new PasswordReset({
      tokenHash: 'x',
      userId: 1,
      expiresAt: Date.parse('2026-10-03T09:00:00Z'),
      now: 0,
    });
    passwordReset.user = Object.assign(Object.create(User.prototype) as User, { email: 'Alice@Example.com' });
    check.mockResolvedValue({ state: PasswordResetState.VALID, passwordReset });

    expect(await controller.checkPasswordReset({ token: TOKEN })).toEqual({
      state: PasswordResetState.VALID,
      passwordReset: { email: 'Alice@Example.com', expiresAt: '2026-10-03T09:00:00.000Z' },
    });
    expect(check).toHaveBeenCalledWith(TOKEN);
  });

  it.each([PasswordResetState.EXPIRED, PasswordResetState.USED, PasswordResetState.INVALID])(
    'answers %s without the account',
    async state => {
      check.mockResolvedValue({ state, passwordReset: null });

      expect(await controller.checkPasswordReset({ token: TOKEN })).toEqual({ state, passwordReset: null });
    }
  );

  it('resets the password and answers only the new session token', async () => {
    resetPassword.mockResolvedValue({ sessionToken: 'd'.repeat(64), user: {}, session: {}, keyFetchToken: null });

    expect(await controller.resetPassword(credentials, request)).toEqual({ sessionToken: 'd'.repeat(64) });
    expect(resetPassword).toHaveBeenCalledWith(
      { resetToken: TOKEN, authPw: credentials.authPw, clientSalt: credentials.clientSalt },
      'Firefox'
    );
  });

  it.each<[PasswordResetRefusal['reason'], string]>([
    ['invalid-link', PASSWORD_RESET_INVALID_MESSAGE],
    ['account-disabled', PASSWORD_RESET_ACCOUNT_DISABLED_MESSAGE],
  ])('words a %s refusal as a 400', async (reason, message) => {
    resetPassword.mockRejectedValue(new PasswordResetRefusedError({ reason }));

    await expect(controller.resetPassword(credentials, request)).rejects.toThrow(new BadRequestException(message));
  });

  it('is reachable without a session', () => {
    expect(Reflect.getMetadata(NO_AUTH_METADATA_KEY, PasswordResetController)).toBe(true);
  });
});
