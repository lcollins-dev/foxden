import { describe, expect, it } from 'vitest';

import { Device } from '@/core/device/entities/device.entity';
import { RefreshToken } from '@/core/oauth/entities/refresh-token.entity';
import { Session } from '@/core/session/entities/session.entity';

import { attachedClientEntries, deviceListEntries, deviceResponse } from './device-response';

const ANDROID_CLIENT_ID = 'a2270f727f45f648';

const PUSH = {
  pushCallback: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
  pushPublicKey: 'BCp93zru09_hab2Bg37LpTNG',
  pushAuthKey: 'KFJhlHMnm_NNhqqpzHkeFw',
};

const storedDevice = (overrides: Partial<Device> = {}): Device =>
  Object.assign(new Device({ id: 'd'.repeat(32), userId: 7, sessionId: 3, now: 1 }), { name: 'Firefox' }, overrides);

const storedSession = (id: number, overrides: Partial<Session> = {}): Session =>
  Object.assign(
    new Session({ tokenIdHash: `hash-${id}`, userId: 7, userAgent: 'Mozilla/5.0', now: 100 }),
    { id },
    overrides
  );

const storedRefreshToken = (sessionId: number, overrides: Partial<RefreshToken> = {}): RefreshToken =>
  Object.assign(
    new RefreshToken({
      tokenHash: `token-${sessionId}`,
      userId: 7,
      sessionId,
      clientId: ANDROID_CLIENT_ID,
      scope: 'profile https://identity.mozilla.com/apps/oldsync',
      now: 100,
    }),
    overrides
  );

describe('device responses', () => {
  it('echoes the push fields and commands only when they were registered', () => {
    expect(deviceResponse(storedDevice())).not.toHaveProperty('pushCallback');

    const commands = { 'https://identity.mozilla.com/cmd/open-uri': '{"kid":"1"}' };
    const response = deviceResponse(storedDevice({ ...PUSH, availableCommandsJson: JSON.stringify(commands) }));

    expect(response).toMatchObject({ id: 'd'.repeat(32), name: 'Firefox', ...PUSH, availableCommands: commands });
  });

  describe('deviceListEntries', () => {
    const otherDevice = (overrides: Partial<Device> = {}): Device =>
      storedDevice({ id: 'e'.repeat(32), sessionId: 4, ...overrides });

    it('marks the calling session`s device as current and drops createdAt', () => {
      const entries = deviceListEntries([storedDevice(), otherDevice()], [], [], 3);

      expect(entries.map(entry => [entry.id, entry.isCurrentDevice])).toEqual([
        ['d'.repeat(32), true],
        ['e'.repeat(32), false],
      ]);
      expect(entries[0]).not.toHaveProperty('createdAt');
      expect(entries[0]).toMatchObject({ lastAccessTime: 1, location: {} });
    });

    it('reports the latest use of the device, its session or the session`s refresh token', () => {
      const [fromSession, fromRefreshToken] = deviceListEntries(
        [storedDevice({ lastAccessAt: 500 }), otherDevice({ lastAccessAt: 500 })],
        [storedSession(3, { lastAccessAt: 900 }), storedSession(4, { lastAccessAt: 400 })],
        [storedRefreshToken(4, { lastUsedAt: 700 })],
        3
      );

      expect(fromSession.lastAccessTime).toBe(900);
      expect(fromRefreshToken.lastAccessTime).toBe(700);
    });

    it('leaves out a device last seen at or before the idle timestamp, keeping the caller`s', () => {
      const sessions = [storedSession(3, { lastAccessAt: 100 }), storedSession(4, { lastAccessAt: 1000 })];
      const devices = [storedDevice(), otherDevice(), storedDevice({ id: 'f'.repeat(32), sessionId: 5 })];
      const refreshTokens = [storedRefreshToken(5, { lastUsedAt: 1001 })];

      const listed = (timestamp?: number) =>
        deviceListEntries(devices, sessions, refreshTokens, 3, timestamp).map(entry => entry.id[0]);

      expect(listed(1000)).toEqual(['d', 'f']);
      expect(listed(999)).toEqual(['d', 'e', 'f']);
      expect(listed(5000)).toEqual(['d']);
    });

    it('lists every device when the idle timestamp is absent or 0, as Mozilla`s truthy check does', () => {
      const devices = [storedDevice(), otherDevice()];

      expect(deviceListEntries(devices, [], [], 3)).toHaveLength(2);
      expect(deviceListEntries(devices, [], [], 3, 0)).toHaveLength(2);
    });
  });

  describe('attachedClientEntries', () => {
    it('lists a mobile session, its device and its refresh token as one entry', () => {
      const clients = attachedClientEntries(
        [storedSession(3, { createdAt: 200, lastAccessAt: 400 })],
        [storedDevice({ name: 'Pixel 8', type: 'mobile', createdAt: 300, lastAccessAt: 500 })],
        [storedRefreshToken(3, { createdAt: 150, lastUsedAt: 600 })],
        3
      );

      expect(clients).toEqual([
        {
          clientId: ANDROID_CLIENT_ID,
          deviceId: 'd'.repeat(32),
          sessionTokenHandle: null,
          refreshTokenId: null,
          isCurrentSession: true,
          deviceType: 'mobile',
          name: 'Pixel 8',
          createdTime: 150,
          lastAccessTime: 600,
          scope: null,
          location: {},
          userAgent: 'Mozilla/5.0',
          os: null,
        },
      ]);
    });

    it('takes the earliest creation and latest access from whichever of the three holds it', () => {
      const [client] = attachedClientEntries(
        [storedSession(3, { createdAt: 200, lastAccessAt: 900 })],
        [storedDevice({ createdAt: 50, lastAccessAt: 500 })],
        [storedRefreshToken(3, { createdAt: 150, lastUsedAt: 600 })],
        3
      );

      expect(client).toMatchObject({ createdTime: 50, lastAccessTime: 900 });
    });

    it('lists a refresh token whose app has not registered its device yet under the app`s name', () => {
      const [client] = attachedClientEntries([storedSession(3)], [], [storedRefreshToken(3)], 3);

      expect(client).toMatchObject({
        clientId: ANDROID_CLIENT_ID,
        deviceId: null,
        deviceType: null,
        name: 'Firefox for Android',
      });
    });

    it('names a device registered without a name after its OAuth client', () => {
      const [client] = attachedClientEntries(
        [storedSession(3)],
        [storedDevice({ name: '' })],
        [storedRefreshToken(3)],
        4
      );

      expect(client).toMatchObject({ name: 'Firefox for Android', isCurrentSession: false });
    });

    it('lists a desktop session with its device, and a web session, without a client id', () => {
      const clients = attachedClientEntries(
        [storedSession(3), storedSession(4, { userAgent: null })],
        [storedDevice()],
        [],
        4
      );

      expect(clients).toEqual([
        expect.objectContaining({ clientId: null, deviceId: 'd'.repeat(32), deviceType: 'desktop', name: 'Firefox' }),
        expect.objectContaining({ clientId: null, deviceId: null, deviceType: null, name: null, userAgent: '' }),
      ]);
    });

    it('drops an idle device from its session`s entry but keeps the session, as Mozilla merges after filtering', () => {
      const clients = attachedClientEntries(
        [storedSession(3, { createdAt: 200, lastAccessAt: 400 }), storedSession(4, { lastAccessAt: 300 })],
        [storedDevice({ name: 'Pixel 8', type: 'mobile', createdAt: 50, lastAccessAt: 300 })],
        [storedRefreshToken(3, { createdAt: 150, lastUsedAt: 350 })],
        4,
        400
      );

      expect(clients[0]).toMatchObject({
        clientId: ANDROID_CLIENT_ID,
        deviceId: null,
        deviceType: null,
        name: 'Firefox for Android',
        createdTime: 150,
        lastAccessTime: 400,
      });
    });

    it('keeps the device of a session seen after the idle timestamp, and the caller`s however old', () => {
      const sessions = [storedSession(3, { lastAccessAt: 100 }), storedSession(4, { lastAccessAt: 900 })];
      const devices = [storedDevice(), storedDevice({ id: 'e'.repeat(32), sessionId: 4 })];

      const clients = attachedClientEntries(sessions, devices, [], 3, 500);

      expect(clients.map(client => client.deviceId)).toEqual(['d'.repeat(32), 'e'.repeat(32)]);
    });
  });
});
