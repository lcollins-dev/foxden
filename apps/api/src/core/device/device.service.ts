import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Device } from './entities/device.entity';
import { Session } from '@/core/session/entities/session.entity';

import { SessionService } from '@/core/session/session.service';

import { DeviceRefusedError } from './device-refusal';
import { randomHex } from '@/common/secret-token';

/** What a registration may set; a field left out keeps its stored value. */
export interface IDeviceFields {
  id?: string;
  name?: string;
  type?: string;
  pushCallback?: string;
  pushPublicKey?: string;
  pushAuthKey?: string;
  availableCommands?: Record<string, unknown>;
}

const COMMAND_NAME = /^(?!(?:__proto__|constructor|prototype)$)[a-zA-Z0-9._/\-:]{1,100}$/;

const MAX_COMMAND_LENGTH = 2048;

/** fxa-auth-server/lib/devices.js availableCommands: command name to a string of at most 2048 characters. */
function readAvailableCommands(value: Record<string, unknown>): Record<string, string> {
  const commands: Record<string, string> = {};

  for (const [name, command] of Object.entries(value)) {
    if (!COMMAND_NAME.test(name) || typeof command !== 'string' || command.length > MAX_COMMAND_LENGTH) {
      throw new DeviceRefusedError({ reason: 'invalid-available-commands' });
    }

    commands[name] = command;
  }

  return commands;
}

export function storedCommands(device: Device): Record<string, string> {
  const parsed: unknown = JSON.parse(device.availableCommandsJson);

  return typeof parsed === 'object' && parsed !== null ? readAvailableCommands({ ...parsed }) : {};
}

@Injectable()
export class DeviceService {
  constructor(
    private readonly sessionService: SessionService,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>
  ) {}

  /** Registers the session's device, or updates it when `id` is given. */
  async registerOrUpdate(session: Session, fields: IDeviceFields): Promise<Device> {
    const pushFields = [fields.pushCallback, fields.pushPublicKey, fields.pushAuthKey].filter(
      field => field !== undefined
    );

    if (pushFields.length !== 0 && pushFields.length !== 3) {
      throw new DeviceRefusedError({ reason: 'incomplete-push' });
    }

    const sessionDevice = await this.deviceRepository.findOne({ where: { sessionId: session.id } });
    const now = Date.now();

    let device: Device;
    let isNew = false;

    if (fields.id === undefined) {
      // Mozilla keeps the session's existing device id rather than creating a second device.
      isNew = sessionDevice === null;
      device = sessionDevice ?? new Device({ id: randomHex(16), userId: session.userId, sessionId: session.id, now });
    } else {
      const existing = await this.deviceRepository.findOne({ where: { id: fields.id, userId: session.userId } });

      if (existing === null) {
        throw new DeviceRefusedError({ reason: 'unknown-device' });
      }

      if (existing.sessionId !== session.id) {
        throw new DeviceRefusedError({ reason: 'session-has-device', deviceId: existing.id });
      }

      device = existing;
    }

    device.name = fields.name ?? device.name;
    device.type = fields.type ?? device.type;
    device.lastAccessAt = now;

    if (fields.pushCallback !== undefined && fields.pushPublicKey !== undefined && fields.pushAuthKey !== undefined) {
      device.pushEndpointExpired = device.pushEndpointExpired && fields.pushCallback === device.pushCallback;
      device.pushCallback = fields.pushCallback;
      device.pushPublicKey = fields.pushPublicKey;
      device.pushAuthKey = fields.pushAuthKey;
    }

    if (fields.availableCommands !== undefined) {
      device.availableCommandsJson = JSON.stringify(readAvailableCommands(fields.availableCommands));
    }

    if (isNew) {
      await this.deviceRepository.insert(device);
    } else {
      await this.deviceRepository.update(
        { id: device.id },
        {
          name: device.name,
          type: device.type,
          lastAccessAt: device.lastAccessAt,
          pushCallback: device.pushCallback,
          pushPublicKey: device.pushPublicKey,
          pushAuthKey: device.pushAuthKey,
          pushEndpointExpired: device.pushEndpointExpired,
          availableCommandsJson: device.availableCommandsJson,
        }
      );
    }

    return device;
  }

  /** Oldest first. */
  async findForUser(userId: number): Promise<Device[]> {
    return this.deviceRepository.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async findForSession(sessionId: number): Promise<Device | null> {
    return this.deviceRepository.findOne({ where: { sessionId } });
  }

  /** Removes the device and signs out the session it belongs to, as Mozilla does. */
  async destroy(session: Session, deviceId: string): Promise<void> {
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, userId: session.userId } });

    if (device === null) {
      throw new DeviceRefusedError({ reason: 'unknown-device' });
    }

    if (device.sessionId === null) {
      await this.deviceRepository.delete({ id: device.id });
    } else {
      await this.sessionService.destroySession(device.sessionId);
    }
  }
}
