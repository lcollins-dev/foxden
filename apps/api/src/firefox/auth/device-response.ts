import { omit } from 'lodash';

import { Device } from '@/core/device/entities/device.entity';
import { RefreshToken } from '@/core/oauth/entities/refresh-token.entity';
import { Session } from '@/core/session/entities/session.entity';

import { storedCommands } from '@/core/device/device.service';

import { findClient } from '@/core/oauth/oauth-clients';

/** The device record Firefox reads back; push fields only when all three are set. */
export interface IDeviceResponse {
  id: string;
  name: string;
  type: string;
  createdAt: number;
  pushCallback?: string;
  pushPublicKey?: string;
  pushAuthKey?: string;
  pushEndpointExpired: boolean;
  availableCommands: Record<string, string>;
}

export interface IDeviceListEntry extends Omit<IDeviceResponse, 'createdAt'> {
  isCurrentDevice: boolean;
  lastAccessTime: number;
  location: Record<string, never>;
}

/** The item shape of fxa-auth-server/lib/routes/attached-clients.js; Firefox reads `clientId` and `lastAccessTime`. */
export interface IAttachedClient {
  clientId: string | null;
  deviceId: string | null;
  sessionTokenHandle: null;
  refreshTokenId: null;
  isCurrentSession: boolean;
  deviceType: string | null;
  name: string | null;
  createdTime: number;
  lastAccessTime: number;
  scope: null;
  location: Record<string, never>;
  userAgent: string;
  os: null;
}

export function deviceResponse(device: Device): IDeviceResponse {
  const response: IDeviceResponse = {
    id: device.id,
    name: device.name,
    type: device.type,
    createdAt: device.createdAt,
    pushEndpointExpired: device.pushEndpointExpired,
    availableCommands: storedCommands(device),
  };

  if (device.pushCallback !== null && device.pushPublicKey !== null && device.pushAuthKey !== null) {
    response.pushCallback = device.pushCallback;
    response.pushPublicKey = device.pushPublicKey;
    response.pushAuthKey = device.pushAuthKey;
  }

  return response;
}

/**
 * `device.lastAccessAt` moves only when Firefox registers or updates the device, so the session and its refresh token carry the device's use, as
 * Mozilla's do (fxa-auth-server/lib/routes/devices-and-sessions.js).
 */
function lastAccess(device?: Device, session?: Session, refreshToken?: RefreshToken): number {
  return Math.max(device?.lastAccessAt ?? 0, session?.lastAccessAt ?? 0, refreshToken?.lastUsedAt ?? 0);
}

/**
 * Mozilla's `filterIdleDevicesTimestamp`: a device seen after it, or every device when it is absent or 0. The caller's
 * device always lists, as Mozilla's does by touching the caller's session to the millisecond first.
 */
function isListed(lastAccessTime: number, isCurrent: boolean, filterIdleDevicesTimestamp: number | undefined): boolean {
  if (filterIdleDevicesTimestamp === undefined || filterIdleDevicesTimestamp === 0 || isCurrent) {
    return true;
  }

  return lastAccessTime > filterIdleDevicesTimestamp;
}

export function deviceListEntries(
  devices: Device[],
  sessions: Session[],
  refreshTokens: RefreshToken[],
  currentSessionId: number,
  filterIdleDevicesTimestamp?: number
): IDeviceListEntry[] {
  const entries = devices.map(device => {
    const session = sessions.find(candidate => candidate.id === device.sessionId);
    const refreshToken = refreshTokens.find(candidate => candidate.sessionId === device.sessionId);

    return {
      ...omit(deviceResponse(device), 'createdAt'),
      isCurrentDevice: device.sessionId === currentSessionId,
      lastAccessTime: lastAccess(device, session, refreshToken),
      location: {},
    };
  });

  return entries.filter(entry => isListed(entry.lastAccessTime, entry.isCurrentDevice, filterIdleDevicesTimestamp));
}

/**
 * One entry per session, folding in its device and refresh token in the order of Mozilla's ConnectedServicesFactory
 * (fxa-shared/connected-services/factories.ts): device, then OAuth client, then session. Holding a session, every entry
 * gets `scope: null`, and a device without a name takes its OAuth client's. An idle device is left out before the merge,
 * as fxa-auth-server/lib/routes/attached-clients.js does, so its session still lists without it.
 */
export function attachedClientEntries(
  sessions: Session[],
  devices: Device[],
  refreshTokens: RefreshToken[],
  currentSessionId: number,
  filterIdleDevicesTimestamp?: number
): IAttachedClient[] {
  return sessions.map(session => {
    const refreshToken = refreshTokens.find(candidate => candidate.sessionId === session.id);
    const sessionDevice = devices.find(candidate => candidate.sessionId === session.id);
    const isCurrent = session.id === currentSessionId;

    const device =
      sessionDevice !== undefined &&
      isListed(lastAccess(sessionDevice, session, refreshToken), isCurrent, filterIdleDevicesTimestamp)
        ? sessionDevice
        : undefined;

    const deviceName = device?.name === '' ? undefined : device?.name;
    const clientName = refreshToken === undefined ? undefined : findClient(refreshToken.clientId)?.name;

    return {
      clientId: refreshToken?.clientId ?? null,
      deviceId: device?.id ?? null,
      sessionTokenHandle: null,
      refreshTokenId: null,
      isCurrentSession: isCurrent,
      deviceType: device?.type ?? null,
      name: deviceName ?? clientName ?? null,
      createdTime: Math.min(session.createdAt, device?.createdAt ?? Infinity, refreshToken?.createdAt ?? Infinity),
      lastAccessTime: lastAccess(device, session, refreshToken),
      scope: null,
      location: {},
      userAgent: session.userAgent ?? '',
      os: null,
    };
  });
}
