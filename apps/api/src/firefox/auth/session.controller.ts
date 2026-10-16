import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { FxaSession, FxaSessionGuard } from '@/firefox/fxa/fxa-session.guard';

import { IResolvedSession, SessionService } from '@/core/session/session.service';

/** Session routes of the auth server (fxa-auth-server/lib/routes/session.js). */
@UseGuards(FxaSessionGuard)
@Controller('auth/v1/session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('status')
  status(@FxaSession() { user }: IResolvedSession) {
    return {
      state: 'verified',
      uid: user.uid,
      details: {
        accountEmailVerified: true,
        sessionVerificationMethod: null,
        sessionVerified: true,
        sessionVerificationMeetsMinimumAAL: true,
        verified: true,
      },
    };
  }

  /**
   * Firefox sends `{}` and parses every success body as JSON, so this answers `{}`. Mozilla's optional
   * `customSessionToken` is not read: only the calling session is destroyed.
   */
  @Post('destroy')
  @HttpCode(200)
  async destroy(@FxaSession() { session }: IResolvedSession): Promise<object> {
    await this.sessionService.destroySession(session.id);

    return {};
  }
}
