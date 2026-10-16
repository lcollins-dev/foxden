import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ms from 'ms';
import { In, Not, Repository } from 'typeorm';

import { Session } from './entities/session.entity';
import { Device } from '@/core/device/entities/device.entity';
import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';

import { hashToken, randomHex } from '@/common/secret-token';
import { deriveTokenId, readTokenId } from '@/core/session/token-credentials';

export interface IResolvedSession {
  session: Session;
  user: User;
}

export interface ICreatedSession {
  session: Session;
  /** The 32-byte seed as hex, returned to the client once and never stored. */
  sessionToken: string;
}

const LAST_ACCESS_RESOLUTION_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>
  ) {}

  async createSession(userId: number, userAgent: string | null): Promise<ICreatedSession> {
    const sessionToken = randomHex(32);
    const { tokenId } = deriveTokenId(sessionToken, 'sessionToken');

    const session = new Session({ tokenIdHash: hashToken(tokenId), userId, userAgent, now: Date.now() });
    await this.sessionRepository.insert(session);

    return { session, sessionToken };
  }

  /** Resolves `Bearer fxs_<id>` or Hawk to a live session of an enabled account, or null. */
  async resolve(authorization: string | undefined): Promise<IResolvedSession | null> {
    const tokenId = readTokenId(authorization, 'sessionToken');

    if (tokenId === null) {
      return null;
    }

    const session = await this.sessionRepository.findOne({
      where: { tokenIdHash: hashToken(tokenId) },
      relations: { user: { userUserRoles: true } },
    });

    if (session?.user === undefined || !session.user.enabled) {
      return null;
    }

    if (await this.expireIfDue(session)) {
      return null;
    }

    await this.recordAccess(session);

    return { session, user: session.user };
  }

  /**
   * Deletes a session that never registered a device once it is older than `SESSION_WITHOUT_DEVICE_EXPIRY`, with its
   * OAuth codes and tokens, and answers true. Mozilla's `tokenLifetimes.sessionTokenWithoutDevice`.
   */
  async expireIfDue(session: Session): Promise<boolean> {
    const lifetime = this.lifetimeWithoutDevice();

    if (lifetime === 0 || Date.now() - session.createdAt < lifetime) {
      return false;
    }

    if (await this.deviceRepository.existsBy({ sessionId: session.id })) {
      return false;
    }

    await this.sessionRepository.delete({ id: session.id });

    return true;
  }

  /** Deletes every session `expireIfDue` would, answering how many went. */
  async purgeExpired(now: number): Promise<number> {
    const lifetime = this.lifetimeWithoutDevice();

    if (lifetime === 0) {
      return 0;
    }

    const result = await this.sessionRepository
      .createQueryBuilder()
      .delete()
      .where('"createdAt" <= :cutoff', { cutoff: now - lifetime })
      .andWhere('NOT EXISTS (SELECT 1 FROM "device" WHERE "device"."sessionId" = "session"."id")')
      .execute();

    return result.affected ?? 0;
  }

  /** Moves `lastAccessAt` on, at most once a minute. */
  async recordAccess(session: Session): Promise<void> {
    const now = Date.now();

    if (now - session.lastAccessAt > LAST_ACCESS_RESOLUTION_MS) {
      session.lastAccessAt = now;
      await this.sessionRepository.update({ id: session.id }, { lastAccessAt: now });
    }
  }

  /** The session a raw token id names, whatever state its account is in. */
  async findByTokenId(tokenId: string): Promise<Session | null> {
    return this.sessionRepository.findOne({ where: { tokenIdHash: hashToken(tokenId) } });
  }

  async listSessions(userId: number): Promise<Session[]> {
    return this.sessionRepository.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  listSessionsNewestFirst(userId: number): Promise<Session[]> {
    return this.sessionRepository.find({ where: { userId }, order: { createdAt: 'DESC', id: 'DESC' } });
  }

  /** An account without a session has no entry. */
  async lastAccessByUser(userIds: number[]): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await this.sessionRepository
      .createQueryBuilder('session')
      .select('session.userId', 'userId')
      .addSelect('MAX(session.lastAccessAt)', 'lastAccessAt')
      .where({ userId: In(userIds) })
      .groupBy('session.userId')
      .getRawMany<{ userId: number; lastAccessAt: number }>();

    return new Map(rows.map(row => [row.userId, row.lastAccessAt]));
  }

  /** Its device and the OAuth codes and tokens it obtained go with it through the foreign keys. */
  async destroySession(sessionId: number): Promise<void> {
    await this.sessionRepository.delete({ id: sessionId });
  }

  /** False when the account has no session with this id. Its device and OAuth tokens go with it. */
  async destroyOwnSession(userId: number, sessionId: number): Promise<boolean> {
    const result = await this.sessionRepository.delete({ id: sessionId, userId });

    return (result.affected ?? 0) > 0;
  }

  /** Answers how many sessions went. Their devices and OAuth tokens go with them. */
  async destroyOtherSessions(userId: number, keptSessionId: number): Promise<number> {
    const result = await this.sessionRepository.delete({ userId, id: Not(keptSessionId) });

    return result.affected ?? 0;
  }

  async destroyAllSessions(userId: number): Promise<void> {
    await this.sessionRepository.delete({ userId });
  }

  private lifetimeWithoutDevice(): number {
    return ms(this.configService.sessionWithoutDeviceExpiry);
  }
}
