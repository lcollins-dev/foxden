import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ChangeEmailRequestDto,
  AccountSessionDto,
  IdParamDto,
  ProfileResponseDto,
  SessionListResponseDto,
  SignOutOthersResponseDto,
  UpdateProfileRequestDto,
} from '@libs/dto';

import { GetUser } from './decorators/user.decorator';
import { ALLOWED_DURING_SETUP_METADATA_KEY, SESSION_EXPIRED_MESSAGE } from './guards/auth.guard';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { Device } from '@/core/device/entities/device.entity';
import { Session } from '@/core/session/entities/session.entity';
import { User } from '@/core/user/entities/user.entity';

import { DeviceService } from '@/core/device/device.service';
import { SessionService } from '@/core/session/session.service';
import { UserService } from '@/core/user/user.service';

export const SESSION_MISSING_MESSAGE = "This session doesn't exist or has already been signed out";

function accountSession(session: Session, device: Device | undefined, currentSessionId: number): AccountSessionDto {
  return {
    id: session.id,
    device: device === undefined ? null : { name: device.name, type: device.type },
    userAgent: session.userAgent,
    createdAt: new Date(session.createdAt).toJSON(),
    lastAccessAt: new Date(session.lastAccessAt).toJSON(),
    current: session.id === currentSessionId,
  };
}

@Controller('api/v1/user')
export class UserController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly sessionService: SessionService,
    private readonly userService: UserService
  ) {}

  @Get('profile')
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  getProfile(@GetUser() user: User): ProfileResponseDto {
    return {
      uid: user.uid,
      name: user.name,
      email: user.email,
      userRoleIds: (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId),
      mustChangePassword: user.mustChangePassword,
    };
  }

  @Patch('profile')
  async updateProfile(
    @GetUser() user: User,
    @Body(new ZodPipe(UpdateProfileRequestDto)) updateProfileDto: UpdateProfileRequestDto
  ): Promise<void> {
    await this.userService.updateName(updateProfileDto.name, user.id);
  }

  @Post('email')
  @HttpCode(200)
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  async changeEmail(
    @GetUser() user: User,
    @Body(new ZodPipe(ChangeEmailRequestDto)) changeEmailDto: ChangeEmailRequestDto
  ): Promise<void> {
    await this.userService.changeEmail(changeEmailDto.email, changeEmailDto.authPw, user.id);
  }

  /** Ends only the calling session, as `POST /auth/v1/session/destroy` does for Firefox. */
  @Post('logout')
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  async doLogout(@Headers('authorization') authorization: string | undefined): Promise<void> {
    const resolved = await this.sessionService.resolve(authorization);

    if (resolved !== null) {
      await this.sessionService.destroySession(resolved.session.id);
    }
  }

  @Get('session/list')
  async getSessionList(
    @GetUser() user: User,
    @Headers('authorization') authorization: string | undefined
  ): Promise<SessionListResponseDto> {
    const current = await this.callingSession(authorization);
    const sessions = await this.sessionService.listSessionsNewestFirst(user.id);
    const devices = await this.deviceService.findForUser(user.id);

    const deviceBySession = new Map<number, Device>();

    for (const device of devices) {
      if (device.sessionId !== null) {
        deviceBySession.set(device.sessionId, device);
      }
    }

    return {
      sessionList: sessions.map(session => accountSession(session, deviceBySession.get(session.id), current.id)),
    };
  }

  @Delete('session/:sessionId')
  async deleteSession(
    @GetUser() user: User,
    @Param('sessionId', new ZodPipe(IdParamDto)) sessionId: number
  ): Promise<void> {
    if (!(await this.sessionService.destroyOwnSession(user.id, sessionId))) {
      throw new NotFoundException(SESSION_MISSING_MESSAGE);
    }
  }

  @Post('session/sign-out-others')
  @HttpCode(200)
  async signOutOthers(
    @GetUser() user: User,
    @Headers('authorization') authorization: string | undefined
  ): Promise<SignOutOthersResponseDto> {
    const current = await this.callingSession(authorization);

    return { signedOut: await this.userService.signOutOtherSessions(user.id, current.id) };
  }

  /** Resolves to nothing only when the session ended after `AuthGuard` resolved it. */
  private async callingSession(authorization: string | undefined): Promise<Session> {
    const resolved = await this.sessionService.resolve(authorization);

    if (resolved === null) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    return resolved.session;
  }
}
