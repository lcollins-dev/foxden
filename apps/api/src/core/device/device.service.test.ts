import { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Device } from '@/core/device/entities/device.entity';
import { Session } from '@/core/session/entities/session.entity';

import { DeviceService, IDeviceFields, storedCommands } from '@/core/device/device.service';
import { SessionService } from '@/core/session/session.service';

const session = { id: 3, userId: 7 } as Session;

const PUSH = {
  pushCallback: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
  pushPublicKey: 'BCp93zru09_hab2Bg37LpTNG',
  pushAuthKey: 'KFJhlHMnm_NNhqqpzHkeFw',
};

const body = (fields: IDeviceFields): IDeviceFields => fields;

const storedDevice = (overrides: Partial<Device> = {}): Device =>
  Object.assign(new Device({ id: 'd'.repeat(32), userId: 7, sessionId: 3, now: 1 }), overrides);

describe('DeviceService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let destroySession: ReturnType<typeof vi.fn>;
  let service: DeviceService;

  beforeEach(() => {
    repository = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    destroySession = vi.fn();
    service = new DeviceService(
      { destroySession } as unknown as SessionService,
      repository as unknown as Repository<Device>
    );
  });

  it('registers a device for the session and stores what was sent', async () => {
    const device = await service.registerOrUpdate(
      session,
      body({ name: 'Firefox', type: 'desktop', ...PUSH, availableCommands: {} })
    );

    expect(device).toMatchObject({ name: 'Firefox', type: 'desktop', ...PUSH, availableCommandsJson: '{}' });
    expect(device.id).toMatch(/^[0-9a-f]{32}$/);
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 3, userId: 7 }));
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('keeps the session`s device id when a registration carries no id', async () => {
    repository.findOne.mockResolvedValueOnce(storedDevice());

    const device = await service.registerOrUpdate(session, body({ name: 'Renamed' }));

    expect(device).toMatchObject({ id: 'd'.repeat(32), name: 'Renamed' });
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd'.repeat(32) },
      expect.objectContaining({ name: 'Renamed', type: 'desktop' })
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('stores command bundles byte for byte', async () => {
    const commands = { 'https://identity.mozilla.com/cmd/open-uri': '{"kid":"1","IV":"x"}' };
    repository.findOne.mockResolvedValueOnce(storedDevice()).mockResolvedValueOnce(storedDevice());

    const device = await service.registerOrUpdate(session, body({ id: 'd'.repeat(32), availableCommands: commands }));

    expect(storedCommands(device)).toEqual(commands);
  });

  it('refuses an unknown id and another session`s device', async () => {
    await expect(service.registerOrUpdate(session, body({ id: 'e'.repeat(32) }))).rejects.toMatchObject({
      refusal: { reason: 'unknown-device' },
    });

    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(storedDevice({ sessionId: 99 }));
    await expect(service.registerOrUpdate(session, body({ id: 'd'.repeat(32) }))).rejects.toMatchObject({
      refusal: { reason: 'session-has-device', deviceId: 'd'.repeat(32) },
    });
  });

  it('takes the three push fields together or not at all', async () => {
    await expect(service.registerOrUpdate(session, body({ pushCallback: PUSH.pushCallback }))).rejects.toMatchObject({
      refusal: { reason: 'incomplete-push' },
    });
  });

  it('rejects a command that is not a string', async () => {
    await expect(
      service.registerOrUpdate(session, body({ availableCommands: { 'https://identity.mozilla.com/cmd/open-uri': 1 } }))
    ).rejects.toMatchObject({ refusal: { reason: 'invalid-available-commands' } });
  });

  it('destroys a device by signing its session out', async () => {
    repository.findOne.mockResolvedValue(storedDevice());

    await service.destroy(session, 'd'.repeat(32));

    expect(destroySession).toHaveBeenCalledWith(3);
  });
});
