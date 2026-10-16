import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Invite } from '@/core/invite/entities/invite.entity';
import { User } from '@/core/user/entities/user.entity';

import { InviteService } from '@/core/invite/invite.service';
import { EmailService } from '@/email/email.service';

import { InviteAdminController } from '@/api/v1/invite/invite-admin.controller';

const buildInvite = (): Invite => {
  const invite = new Invite({
    tokenHash: 'x',
    email: 'alice@example.com',
    name: 'Alice Lee',
    admin: true,
    expiresAt: Date.parse('2026-10-07T09:00:00Z'),
    now: Date.parse('2026-09-30T09:00:00Z'),
  });
  invite.id = 4;

  return invite;
};

describe('InviteAdminController', () => {
  let inviteService: Record<string, ReturnType<typeof vi.fn>>;
  let isConfigured: ReturnType<typeof vi.fn>;
  let controller: InviteAdminController;

  beforeEach(() => {
    inviteService = {
      inviteByEmail: vi.fn(),
      listPending: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue(true),
    };
    isConfigured = vi.fn().mockReturnValue(false);

    controller = new InviteAdminController(
      inviteService as unknown as InviteService,
      { isConfigured } as unknown as EmailService
    );
  });

  it('answers a new invite with its link, expiry and whether it was emailed', async () => {
    inviteService.inviteByEmail.mockResolvedValue({
      invite: buildInvite(),
      link: 'https://foxden.test/invite',
      emailSent: true,
    });

    const user = { name: 'Sam Lee', email: 'sam@example.com' } as User;

    expect(await controller.createInvite(user, { email: 'alice@example.com', name: 'Alice Lee', admin: true })).toEqual(
      {
        link: 'https://foxden.test/invite',
        expiresAt: '2026-10-07T09:00:00.000Z',
        emailSent: true,
      }
    );
    expect(inviteService.inviteByEmail).toHaveBeenCalledWith('alice@example.com', 'Alice Lee', true, user);
  });

  it('lists the pending invites and whether email is configured', async () => {
    inviteService.listPending.mockResolvedValue([buildInvite()]);
    isConfigured.mockReturnValue(true);

    expect(await controller.getInviteList()).toEqual({
      inviteList: [
        {
          id: 4,
          email: 'alice@example.com',
          name: 'Alice Lee',
          admin: true,
          createdAt: '2026-09-30T09:00:00.000Z',
          expiresAt: '2026-10-07T09:00:00.000Z',
        },
      ],
      emailConfigured: true,
    });
  });

  it('revokes a pending invite', async () => {
    await controller.revokeInvite(4);

    expect(inviteService.revoke).toHaveBeenCalledWith(4);
  });

  it('answers 404 when no pending invite has the id', async () => {
    inviteService.revoke.mockResolvedValue(false);

    await expect(controller.revokeInvite(4)).rejects.toThrow(NotFoundException);
  });
});
