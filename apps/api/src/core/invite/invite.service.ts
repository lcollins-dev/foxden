import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ms from 'ms';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';

import { InviteState } from '@libs/dto';

import { Invite } from './entities/invite.entity';
import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

import { ValidationException } from '@/common/exceptions/validation.exception';
import { publicUrl } from '@/common/public-url';
import { hashToken, randomHex } from '@/common/secret-token';

export const ACCOUNT_EXISTS_MESSAGE = "There's already an account for this email.";
export const INVITE_PENDING_MESSAGE = 'This email already has a pending invite. Revoke it below to send a new one.';

/** Kept past expiry, used or not, so the invite page can still say why a link no longer works. */
export const INVITE_RETENTION_MS = ms('30d');

export interface ICreatedInvite {
  invite: Invite;
  link: string;
}

export interface ISentInvite extends ICreatedInvite {
  emailSent: boolean;
}

export interface IInviteCheck {
  state: InviteState;
  /** Set only for a valid invite. */
  invite: Invite | null;
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @InjectRepository(Invite)
    private readonly inviteRepository: Repository<Invite>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  /** Returns the link, the only place the raw token appears. Refuses an address with an account or a pending invite. */
  async createInvite(email: string, name: string, admin: boolean): Promise<ICreatedInvite> {
    const now = Date.now();
    const normalizedEmail = email.toLowerCase();

    await this.inviteRepository.delete({ expiresAt: LessThan(now - INVITE_RETENTION_MS) });

    if (await this.userRepository.exists({ where: { normalizedEmail } })) {
      throw new ValidationException('email', ACCOUNT_EXISTS_MESSAGE);
    }

    if (await this.inviteRepository.exists({ where: this.pendingWhere(now, { email: normalizedEmail }) })) {
      throw new ValidationException('email', INVITE_PENDING_MESSAGE);
    }

    const token = randomHex(32);
    const invite = new Invite({
      tokenHash: hashToken(token),
      email,
      name,
      admin,
      expiresAt: now + ms(this.configService.inviteExpiry),
      now,
    });

    await this.inviteRepository.insert(invite);

    return { invite, link: publicUrl(this.configService, `/invite/${token}`) };
  }

  /**
   * Creates an invite for an address and emails it when SMTP is configured, with replies going to the inviter; a failed
   * send is logged and ignored.
   */
  async inviteByEmail(email: string, name: string, admin: boolean, inviter: User): Promise<ISentInvite> {
    const { invite, link } = await this.createInvite(email, name, admin);

    const emailSent = await this.emailService.sendEmail(
      email,
      EmailTemplate.INVITE,
      {
        inviterName: inviter.name,
        serverHost: new URL(publicUrl(this.configService)).host,
        admin,
        link,
        expiresAt: invite.expiresAt,
      },
      inviter.email
    );

    this.logger.log({ inviteId: invite.id, admin, emailSent }, 'inviteByEmail(): Invite created');

    return { invite, link, emailSent };
  }

  async findValid(token: string): Promise<Invite | null> {
    const { invite } = await this.check(token);

    return invite;
  }

  /** A used invite reads as used even once it has expired. */
  async check(token: string): Promise<IInviteCheck> {
    const invite = await this.inviteRepository.findOne({ where: { tokenHash: hashToken(token) } });

    if (invite === null) {
      return { state: InviteState.INVALID, invite: null };
    }

    if (invite.usedAt !== null) {
      return { state: InviteState.USED, invite: null };
    }

    if (invite.expiresAt <= Date.now()) {
      return { state: InviteState.EXPIRED, invite: null };
    }

    return { state: InviteState.VALID, invite };
  }

  /** Newest first. */
  listPending(): Promise<Invite[]> {
    return this.inviteRepository.find({
      where: this.pendingWhere(Date.now()),
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** False when no pending invite has this id. */
  async revoke(inviteId: number): Promise<boolean> {
    const result = await this.inviteRepository.delete(this.pendingWhere(Date.now(), { id: inviteId }));

    return (result.affected ?? 0) > 0;
  }

  /** Whether an invite admits this address: its own address, in any case. */
  admits(invite: Invite, email: string): boolean {
    return invite.email === email.toLowerCase();
  }

  /** False when the invite is no longer pending, such as one revoked while the sign-up ran. */
  async consume(invite: Invite): Promise<boolean> {
    const result = await this.inviteRepository.update(this.pendingWhere(Date.now(), { id: invite.id }), {
      usedAt: Date.now(),
    });

    return (result.affected ?? 0) > 0;
  }

  private pendingWhere(now: number, where: { id?: number; email?: string } = {}) {
    return { ...where, usedAt: IsNull(), expiresAt: MoreThan(now) };
  }
}
