import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteState } from '@libs/dto';

import { Invite } from '@/core/invite/entities/invite.entity';
import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import {
  ACCOUNT_EXISTS_MESSAGE,
  INVITE_PENDING_MESSAGE,
  INVITE_RETENTION_MS,
  InviteService,
} from '@/core/invite/invite.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

import { ValidationException } from '@/common/exceptions/validation.exception';
import { hashToken } from '@/common/secret-token';

const NOW = 1790000000000;
const TOKEN = 'a'.repeat(64);

const buildInvite = (overrides: Partial<Invite> = {}): Invite => {
  const invite = new Invite({
    tokenHash: 'x',
    email: 'alice@example.com',
    name: 'Alice',
    admin: false,
    expiresAt: NOW + 1000,
    now: 0,
  });
  invite.id = 3;

  return Object.assign(invite, overrides);
};

describe('InviteService', () => {
  let inviteRepository: Record<string, ReturnType<typeof vi.fn>>;
  let userRepository: Record<string, ReturnType<typeof vi.fn>>;
  let sendEmail: ReturnType<typeof vi.fn>;
  let service: InviteService;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    inviteRepository = {
      insert: vi.fn(),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      update: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false),
    };
    userRepository = { exists: vi.fn().mockResolvedValue(false) };
    sendEmail = vi.fn().mockResolvedValue(false);

    service = new InviteService(
      { webAppBaseUrl: 'https://sync.example/', inviteExpiry: '7d' } as unknown as ConfigService,
      { sendEmail } as unknown as EmailService,
      inviteRepository as unknown as Repository<Invite>,
      userRepository as unknown as Repository<User>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createInvite', () => {
    it('stores the hash of a random token bound to the lowercased address and the name, and links to it', async () => {
      const { invite, link } = await service.createInvite('Alice@Example.com', 'Alice Lee', true);
      const token = link.replace('https://sync.example/invite/', '');

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(invite).toMatchObject({
        tokenHash: hashToken(token),
        email: 'alice@example.com',
        name: 'Alice Lee',
        admin: true,
      });
      expect(invite.usedAt).toBeNull();
      expect(invite.expiresAt - invite.createdAt).toBe(7 * 24 * 60 * 60 * 1000);
      expect(inviteRepository.insert).toHaveBeenCalledWith(invite);
    });

    it('purges invites that expired more than the retention period ago, used or not', async () => {
      await service.createInvite('alice@example.com', 'Alice', false);

      expect(inviteRepository.delete).toHaveBeenCalledWith({ expiresAt: LessThan(NOW - INVITE_RETENTION_MS) });
      expect(INVITE_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('refuses an address an account already has, in any case', async () => {
      userRepository.exists.mockResolvedValue(true);

      await expect(service.createInvite('Alice@Example.com', 'Alice', false)).rejects.toEqual(
        new ValidationException('email', ACCOUNT_EXISTS_MESSAGE)
      );
      expect(userRepository.exists).toHaveBeenCalledWith({ where: { normalizedEmail: 'alice@example.com' } });
      expect(inviteRepository.insert).not.toHaveBeenCalled();
    });

    it('refuses an address with a pending invite', async () => {
      inviteRepository.exists.mockResolvedValue(true);

      await expect(service.createInvite('Alice@Example.com', 'Alice', false)).rejects.toEqual(
        new ValidationException('email', INVITE_PENDING_MESSAGE)
      );
      expect(inviteRepository.exists).toHaveBeenCalledWith({
        where: { email: 'alice@example.com', usedAt: IsNull(), expiresAt: MoreThan(NOW) },
      });
      expect(inviteRepository.insert).not.toHaveBeenCalled();
    });
  });

  it('emails the link from the inviter and reports a skipped or failed send without failing', async () => {
    const inviter = { name: 'Sam Lee', email: 'sam@example.com' } as User;

    const response = await service.inviteByEmail('alice@example.com', 'Alice', true, inviter);

    expect(sendEmail).toHaveBeenCalledWith(
      'alice@example.com',
      EmailTemplate.INVITE,
      {
        inviterName: 'Sam Lee',
        serverHost: 'sync.example',
        admin: true,
        link: response.link,
        expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
      },
      'sam@example.com'
    );
    expect(response.emailSent).toBe(false);
  });

  describe('check', () => {
    it('answers a valid invite with the invite', async () => {
      const invite = buildInvite();
      inviteRepository.findOne.mockResolvedValue(invite);

      expect(await service.check(TOKEN)).toEqual({ state: InviteState.VALID, invite });
      expect(inviteRepository.findOne).toHaveBeenCalledWith({ where: { tokenHash: hashToken(TOKEN) } });
    });

    it('answers invalid for a token no invite has', async () => {
      inviteRepository.findOne.mockResolvedValue(null);

      expect(await service.check(TOKEN)).toEqual({ state: InviteState.INVALID, invite: null });
    });

    it('answers expired for an unused invite past its expiry', async () => {
      inviteRepository.findOne.mockResolvedValue(buildInvite({ expiresAt: NOW }));

      expect(await service.check(TOKEN)).toEqual({ state: InviteState.EXPIRED, invite: null });
    });

    it('answers used for a used invite, even once it has expired', async () => {
      inviteRepository.findOne.mockResolvedValueOnce(buildInvite({ usedAt: NOW - 10 }));
      expect(await service.check(TOKEN)).toEqual({ state: InviteState.USED, invite: null });

      inviteRepository.findOne.mockResolvedValueOnce(buildInvite({ usedAt: NOW - 10, expiresAt: NOW - 5 }));
      expect(await service.check(TOKEN)).toEqual({ state: InviteState.USED, invite: null });
    });
  });

  it('finds only unused, unexpired invites', async () => {
    inviteRepository.findOne.mockResolvedValueOnce(buildInvite());
    expect(await service.findValid(TOKEN)).not.toBeNull();

    inviteRepository.findOne.mockResolvedValueOnce(buildInvite({ expiresAt: NOW - 1000 }));
    expect(await service.findValid(TOKEN)).toBeNull();

    inviteRepository.findOne.mockResolvedValueOnce(buildInvite({ usedAt: NOW - 1000 }));
    expect(await service.findValid(TOKEN)).toBeNull();
  });

  it('lists unused, unexpired invites newest first', async () => {
    await service.listPending();

    expect(inviteRepository.find).toHaveBeenCalledWith({
      where: { usedAt: IsNull(), expiresAt: MoreThan(NOW) },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  });

  describe('revoke', () => {
    it('deletes only a pending invite', async () => {
      inviteRepository.delete.mockResolvedValue({ affected: 1 });

      expect(await service.revoke(3)).toBe(true);
      expect(inviteRepository.delete).toHaveBeenCalledWith({ id: 3, usedAt: IsNull(), expiresAt: MoreThan(NOW) });
    });

    it('reports when no pending invite has the id', async () => {
      expect(await service.revoke(3)).toBe(false);
    });
  });

  describe('consume', () => {
    it('marks a pending invite used instead of deleting it', async () => {
      inviteRepository.update.mockResolvedValue({ affected: 1 });

      expect(await service.consume(buildInvite())).toBe(true);
      expect(inviteRepository.update).toHaveBeenCalledWith(
        { id: 3, usedAt: IsNull(), expiresAt: MoreThan(NOW) },
        { usedAt: NOW }
      );
      expect(inviteRepository.delete).not.toHaveBeenCalled();
    });

    it('reports an invite that stopped being pending, so a revoke or a racing sign-up wins', async () => {
      inviteRepository.update.mockResolvedValue({ affected: 0 });

      expect(await service.consume(buildInvite())).toBe(false);
    });
  });

  it('admits only its own address, in any case', () => {
    const invite = buildInvite();

    expect(service.admits(invite, 'ALICE@example.com')).toBe(true);
    expect(service.admits(invite, 'mallory@example.com')).toBe(false);
  });
});
