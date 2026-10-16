import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncSecretService } from './sync-secret.service';
import { IClaimedKeys, TokenserverService } from './tokenserver.service';
import { PublicBaseUrlService } from '@/common/public-base-url.service';
import { SqliteDatabase, SyncDatabaseService } from '@/database/sync-database.service';

import { deriveTokenKey } from './sync-token';
import { ICurrentUser, RETIRED_GENERATION } from './tokenserver-rules';
import { TokenserverUserRepository } from './tokenserver-user.repository';

const MASTER_SECRET = 'Ted Koppel is a robot';
const FXA_UID = '319b98f9961ff1dbdd07313cd6ba925a';

const currentUser: ICurrentUser = {
  uid: 42,
  generation: 0,
  keysChangedAt: 1700000000000,
  clientState: '6ae94683571c7a7c54dab4700aa3995f',
  oldClientStates: [],
};

const claimedKeys: IClaimedKeys = { keysChangedAt: 1700000000000, clientState: '6ae94683571c7a7c54dab4700aa3995f' };

const tokenPayload = (id: string): Record<string, string | number> => {
  const decoded = Buffer.from(id, 'base64url');

  return JSON.parse(decoded.subarray(0, decoded.length - 32).toString('utf8')) as Record<string, string | number>;
};

describe('TokenserverService', () => {
  let getOrCreate: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let raiseGeneration: ReturnType<typeof vi.fn>;
  let retire: ReturnType<typeof vi.fn>;
  let replaceAll: ReturnType<typeof vi.fn>;
  let service: TokenserverService;

  beforeEach(() => {
    getOrCreate = vi.fn().mockReturnValue(currentUser);
    update = vi.fn().mockReturnValue(currentUser.uid);
    raiseGeneration = vi.fn();
    retire = vi.fn();
    replaceAll = vi.fn();

    const db = {} as SqliteDatabase;

    service = new TokenserverService(
      { getOrCreate, update, raiseGeneration, retire, replaceAll } as unknown as TokenserverUserRepository,
      { write: (work: (database: SqliteDatabase) => unknown) => Promise.resolve(work(db)) } as SyncDatabaseService,
      { masterSecret: MASTER_SECRET, metricsHashSecret: Buffer.from('topsecretz') } as SyncSecretService,
      { url: 'https://sync.example.com' } as PublicBaseUrlService
    );
  });

  it('issues a token for the storage node under the public base URL', async () => {
    const credentials = await service.issueToken({ fxaUid: FXA_UID, generation: null }, claimedKeys, 3600);

    expect({ ...credentials, id: 'id', key: 'key' }).toEqual({
      id: 'id',
      key: 'key',
      uid: 42,
      node: 'https://sync.example.com/storage',
      // HMAC-SHA256 of the fxa_uid under metrics secret `topsecretz`, truncated to 32 hex digits as syncstorage-rs
      // `extractors.rs` `fxa_metrics_hash` does.
      hashedFxaUid: '049bbd59065e40fdc5e544d25e42599d',
    });

    const payload = tokenPayload(credentials.id);

    expect(payload).toMatchObject({
      node: 'https://sync.example.com/storage',
      fxa_kid: '1700000000000-aulGg1ccenxU2rRwCqOZXw',
      fxa_uid: FXA_UID,
      hashed_device_id: 'e98b6ca7c3a980c1181454bc5cd0af71',
      uid: 42,
    });
    expect(credentials.key).toBe(deriveTokenKey(MASTER_SECRET, String(payload.salt), credentials.id));
  });

  it('pads fxa_kid to 13 digits and falls back to the generation', async () => {
    getOrCreate.mockReturnValue({ ...currentUser, generation: 1234, keysChangedAt: null, clientState: 'aaaa' });

    const credentials = await service.issueToken(
      { fxaUid: FXA_UID, generation: 1234 },
      { keysChangedAt: null, clientState: 'aaaa' },
      3600
    );

    expect(tokenPayload(credentials.id).fxa_kid).toBe('0000000001234-qqo');
  });

  it('refuses keys that contradict what the account reported before', async () => {
    getOrCreate.mockReturnValue({ ...currentUser, generation: 5 });

    await expect(service.issueToken({ fxaUid: FXA_UID, generation: 4 }, claimedKeys, 3600)).rejects.toMatchObject({
      refusal: { reason: 'invalid-generation' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('raises the generation to one millisecond before a password change', async () => {
    await service.recordPasswordChange(FXA_UID, 1790000000000);

    expect(raiseGeneration).toHaveBeenCalledWith(expect.anything(), FXA_UID, 1789999999999);
  });

  it('replaces and wipes every uid of a re-keyed account in one write, a millisecond before the change', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790000000500);

    await service.recordKeyChange(FXA_UID, 1790000000000);

    expect(replaceAll).toHaveBeenCalledWith(expect.anything(), FXA_UID, 1789999999999, 1790000000500);
    vi.restoreAllMocks();
  });

  it('retires a deleted account in one write', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000);

    await service.retireAccount(FXA_UID);

    expect(retire).toHaveBeenCalledWith(expect.anything(), FXA_UID, 1790000000000);
    vi.restoreAllMocks();
  });

  it('refuses a retired account a token, even one without a generation claim, and allocates nothing', async () => {
    getOrCreate.mockReturnValue({ ...currentUser, generation: RETIRED_GENERATION });

    await expect(service.issueToken({ fxaUid: FXA_UID, generation: null }, claimedKeys, 3600)).rejects.toMatchObject({
      refusal: { reason: 'invalid-generation' },
    });
    await expect(
      service.issueToken({ fxaUid: FXA_UID, generation: 1790000000000 }, claimedKeys, 3600)
    ).rejects.toMatchObject({ refusal: { reason: 'invalid-generation' } });
    expect(update).not.toHaveBeenCalled();
  });
});
