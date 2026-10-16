import { In, Not, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { Device } from '@/core/device/entities/device.entity';
import { Session } from '@/core/session/entities/session.entity';

import { ConfigService } from '@/config/config.service';
import { SessionService } from '@/core/session/session.service';

import { hashToken } from '@/common/secret-token';
import { deriveTokenId } from '@/core/session/token-credentials';

const buildRepository = () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  findOne: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue({ affected: 0 }),
  find: vi.fn().mockResolvedValue([]),
  createQueryBuilder: vi.fn(),
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const buildService = (
  repository: ReturnType<typeof buildRepository>,
  { hasDevice = false, expiry = '1d' }: { hasDevice?: boolean; expiry?: string } = {}
) =>
  new SessionService(
    { sessionWithoutDeviceExpiry: expiry } as unknown as ConfigService,
    repository as unknown as Repository<Session>,
    { existsBy: vi.fn().mockResolvedValue(hasDevice) } as unknown as Repository<Device>
  );

const TOKEN_ID = 'c0a29dcf46174973da1378696e4c82ae10f723cf4f4d9f75e39f4ae3851595ab';

describe('SessionService', () => {
  it('returns the seed once and stores only the hash of the token id derived from it', async () => {
    const repository = buildRepository();
    const service = buildService(repository);

    const { sessionToken, session } = await service.createSession(7, 'Firefox');

    expect(sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenIdHash).toBe(hashToken(deriveTokenId(sessionToken, 'sessionToken').tokenId));
    expect(JSON.stringify(repository.insert.mock.calls[0][0])).not.toContain(sessionToken);
  });

  it('looks a Bearer token up by the hash of its id', async () => {
    const repository = buildRepository();
    const user = { id: 7, enabled: true };
    repository.findOne.mockResolvedValue({ id: 1, createdAt: Date.now(), lastAccessAt: Date.now(), user });

    const resolved = await buildService(repository).resolve(`Bearer fxs_${TOKEN_ID}`);

    expect(resolved?.user).toBe(user);
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenIdHash: hashToken(TOKEN_ID) } })
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('refreshes lastAccessAt at most once a minute', async () => {
    const repository = buildRepository();
    repository.findOne.mockResolvedValue({
      id: 1,
      createdAt: Date.now(),
      lastAccessAt: Date.now() - 120_000,
      user: { enabled: true },
    });

    await buildService(repository).resolve(`Bearer fxs_${TOKEN_ID}`);

    expect(repository.update).toHaveBeenCalledWith({ id: 1 }, { lastAccessAt: expect.any(Number) as number });
  });

  it('refuses a session of a disabled account, an unknown token and a malformed header', async () => {
    const repository = buildRepository();
    const service = buildService(repository);

    repository.findOne.mockResolvedValueOnce({ id: 1, lastAccessAt: 0, user: { enabled: false } });
    expect(await service.resolve(`Bearer fxs_${TOKEN_ID}`)).toBeNull();

    repository.findOne.mockResolvedValueOnce(null);
    expect(await service.resolve(`Bearer fxs_${TOKEN_ID}`)).toBeNull();

    expect(await service.resolve('Bearer nonsense')).toBeNull();
  });

  describe('expiry of a session without a device', () => {
    const resolveCreatedAgo = async (
      age: number,
      options?: { hasDevice?: boolean; expiry?: string }
    ): Promise<{ resolved: unknown; repository: ReturnType<typeof buildRepository> }> => {
      const repository = buildRepository();
      const now = Date.now();
      repository.findOne.mockResolvedValue({ id: 1, createdAt: now - age, lastAccessAt: now, user: { enabled: true } });

      const resolved = await buildService(repository, options).resolve(`Bearer fxs_${TOKEN_ID}`);

      return { resolved, repository };
    };

    it('refuses and deletes the session once it is as old as the lifetime, 1 day by default', async () => {
      const { resolved, repository } = await resolveCreatedAgo(ONE_DAY_MS);

      expect(resolved).toBeNull();
      expect(repository.delete).toHaveBeenCalledWith({ id: 1 });
    });

    it('keeps the session until then', async () => {
      const { resolved, repository } = await resolveCreatedAgo(ONE_DAY_MS - 60_000);

      expect(resolved).not.toBeNull();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('never expires a session that registered a device', async () => {
      const { resolved, repository } = await resolveCreatedAgo(10 * ONE_DAY_MS, { hasDevice: true });

      expect(resolved).not.toBeNull();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('follows the configured lifetime, with 0 turning expiry off', async () => {
      expect((await resolveCreatedAgo(2 * 60 * 60 * 1000, { expiry: '1h' })).resolved).toBeNull();
      expect((await resolveCreatedAgo(10 * ONE_DAY_MS, { expiry: '0' })).resolved).not.toBeNull();
    });

    it('purges nothing while expiry is off', async () => {
      const repository = buildRepository();

      expect(await buildService(repository, { expiry: '0' }).purgeExpired(Date.now())).toBe(0);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  it('lists the account sessions newest first', async () => {
    const repository = buildRepository();

    await buildService(repository).listSessionsNewestFirst(7);

    expect(repository.find).toHaveBeenCalledWith({ where: { userId: 7 }, order: { createdAt: 'DESC', id: 'DESC' } });
  });

  describe('lastAccessByUser', () => {
    it('answers the newest session access of each account from one grouped query', async () => {
      const repository = buildRepository();
      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([
          { userId: 7, lastAccessAt: 1000 },
          { userId: 8, lastAccessAt: 2000 },
        ]),
      };
      repository.createQueryBuilder.mockReturnValue(queryBuilder);

      const lastAccess = await buildService(repository).lastAccessByUser([7, 8, 9]);

      expect(lastAccess).toEqual(
        new Map([
          [7, 1000],
          [8, 2000],
        ])
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith('MAX(session.lastAccessAt)', 'lastAccessAt');
      expect(queryBuilder.where).toHaveBeenCalledWith({ userId: In([7, 8, 9]) });
      expect(queryBuilder.groupBy).toHaveBeenCalledWith('session.userId');
    });

    it('skips the query for no accounts', async () => {
      const repository = buildRepository();

      expect(await buildService(repository).lastAccessByUser([])).toEqual(new Map());
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('destroyOwnSession', () => {
    it('deletes the session only within the account', async () => {
      const repository = buildRepository();
      repository.delete.mockResolvedValue({ affected: 1 });

      expect(await buildService(repository).destroyOwnSession(7, 11)).toBe(true);
      expect(repository.delete).toHaveBeenCalledWith({ id: 11, userId: 7 });
    });

    it('reports a session that is not the account one', async () => {
      const repository = buildRepository();

      expect(await buildService(repository).destroyOwnSession(7, 11)).toBe(false);
    });
  });

  it('deletes every other session of the account and counts them', async () => {
    const repository = buildRepository();
    repository.delete.mockResolvedValue({ affected: 3 });

    expect(await buildService(repository).destroyOtherSessions(7, 11)).toBe(3);
    expect(repository.delete).toHaveBeenCalledWith({ userId: 7, id: Not(11) });
  });
});
