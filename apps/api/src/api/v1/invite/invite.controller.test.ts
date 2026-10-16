import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteState } from '@libs/dto';

import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { Invite } from '@/core/invite/entities/invite.entity';

import { InviteService } from '@/core/invite/invite.service';

import { InviteController } from '@/api/v1/invite/invite.controller';

const TOKEN = 'a'.repeat(64);

describe('InviteController', () => {
  let check: ReturnType<typeof vi.fn>;
  let controller: InviteController;

  beforeEach(() => {
    check = vi.fn();
    controller = new InviteController({ check } as unknown as InviteService);
  });

  it('answers a valid invite with its address, admin flag and expiry', async () => {
    const invite = new Invite({
      tokenHash: 'x',
      email: 'alice@example.com',
      name: 'Alice',
      admin: true,
      expiresAt: Date.parse('2026-10-07T09:00:00Z'),
      now: 0,
    });
    check.mockResolvedValue({ state: InviteState.VALID, invite });

    expect(await controller.checkInvite({ token: TOKEN })).toEqual({
      state: InviteState.VALID,
      invite: { email: 'alice@example.com', admin: true, expiresAt: '2026-10-07T09:00:00.000Z' },
    });
    expect(check).toHaveBeenCalledWith(TOKEN);
  });

  it.each([InviteState.EXPIRED, InviteState.USED, InviteState.INVALID])(
    'answers %s without the invite',
    async state => {
      check.mockResolvedValue({ state, invite: null });

      expect(await controller.checkInvite({ token: TOKEN })).toEqual({ state, invite: null });
    }
  );

  it('is reachable without a session', () => {
    expect(Reflect.getMetadata(NO_AUTH_METADATA_KEY, InviteController)).toBe(true);
  });
});
