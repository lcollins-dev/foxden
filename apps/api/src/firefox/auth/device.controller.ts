import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { FxaDeviceCredentialGuard } from '@/firefox/fxa/fxa-device-credential.guard';
import { FxaSession } from '@/firefox/fxa/fxa-session.guard';
import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { DeviceDestroyDto, DeviceDto, DeviceListQueryDto } from './dto/device.dto';

import { DeviceService } from '@/core/device/device.service';
import { OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';

import {
  attachedClientEntries,
  deviceListEntries,
  deviceResponse,
  IAttachedClient,
  IDeviceListEntry,
  IDeviceResponse,
} from './device-response';
import { fxaErrors } from '@/firefox/fxa/fxa-error';

function idleTimestamp(query: DeviceListQueryDto): number | undefined {
  return query.filterIdleDevicesTimestamp === undefined ? undefined : Number(query.filterIdleDevicesTimestamp);
}

/** The minimal device set Firefox calls on sign-in (fxa-auth-server/lib/routes/devices-and-sessions.js). */
@UseGuards(FxaDeviceCredentialGuard)
@Controller('auth/v1/account')
export class DeviceController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly oauthService: OauthService,
    private readonly sessionService: SessionService
  ) {}

  @Post('device')
  @HttpCode(200)
  async registerOrUpdate(
    @FxaSession() { session }: IResolvedSession,
    @Body(new FxaZodPipe(DeviceDto)) body: DeviceDto
  ): Promise<IDeviceResponse> {
    return deviceResponse(await this.deviceService.registerOrUpdate(session, body));
  }

  @Get('devices')
  async list(
    @FxaSession() { session }: IResolvedSession,
    @Query(new FxaZodPipe(DeviceListQueryDto)) query: DeviceListQueryDto
  ): Promise<IDeviceListEntry[]> {
    const devices = await this.deviceService.findForUser(session.userId);
    const sessions = await this.sessionService.listSessions(session.userId);
    const refreshTokens = await this.oauthService.listRefreshTokens(session.userId);

    return deviceListEntries(devices, sessions, refreshTokens, session.id, idleTimestamp(query));
  }

  /** No send-tab yet, so there are never commands; `messages` must still be an array. */
  @Get('device/commands')
  async commands(
    @FxaSession() { session }: IResolvedSession,
    @Query('index', new FxaZodPipe(z.unknown())) index: unknown
  ): Promise<{ index: number; last: boolean; messages: never[] }> {
    if ((await this.deviceService.findForSession(session.id)) === null) {
      throw fxaErrors.unknownDevice();
    }

    const parsedIndex = Number(index ?? '0');

    return { index: Number.isSafeInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0, last: true, messages: [] };
  }

  @Post('device/destroy')
  @HttpCode(200)
  async destroy(
    @FxaSession() { session }: IResolvedSession,
    @Body(new FxaZodPipe(DeviceDestroyDto)) body: DeviceDestroyDto
  ): Promise<object> {
    await this.deviceService.destroy(session, body.id);

    return {};
  }

  /** The clients engine calls this after every upload; there is no push delivery yet, so it is accepted and dropped. */
  @Post('devices/notify')
  @HttpCode(200)
  notify(): object {
    return {};
  }

  @Get('attached_clients')
  async attachedClientEntries(
    @FxaSession() { session, user }: IResolvedSession,
    @Query(new FxaZodPipe(DeviceListQueryDto)) query: DeviceListQueryDto
  ): Promise<IAttachedClient[]> {
    const sessions = await this.sessionService.listSessions(user.id);
    const devices = await this.deviceService.findForUser(user.id);
    const refreshTokens = await this.oauthService.listRefreshTokens(user.id);

    return attachedClientEntries(sessions, devices, refreshTokens, session.id, idleTimestamp(query));
  }
}
