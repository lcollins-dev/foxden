import { Controller, Get, Header, Headers, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'node:crypto';

import { ConfigService } from '@/config/config.service';
import { AccessTokenService } from '@/core/oauth/access-token.service';

import { publicUrl } from '@/common/public-url';
import { scopeCovers } from '@/core/oauth/oauth-clients';
import { fxaErrors } from '@/firefox/fxa/fxa-error';

export interface IProfile {
  uid: string;
  email: string;
  displayName: string;
  avatar: string;
  avatarDefault: boolean;
  locale: string;
  amrValues: string[];
  twoFactorAuthentication: boolean;
}

const DEFAULT_AVATAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8f8f9d"/>' +
  '<circle cx="32" cy="25" r="11" fill="#fff"/><path d="M12 56c2-12 11-18 20-18s18 6 20 18z" fill="#fff"/></svg>';

/**
 * The profile server Firefox reads the toolbar name and avatar from (ff/services/fxaccounts/FxAccountsProfileClient.sys.mjs).
 * `uid` must match the signed-in account or Firefox discards the profile.
 */
@Controller('profile/v1')
export class ProfileController {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly configService: ConfigService
  ) {}

  @Get('profile')
  async profile(
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<IProfile | undefined> {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const verified = token === undefined ? null : await this.accessTokenService.verify(token);

    if (verified === null) {
      throw fxaErrors.invalidToken('Invalid token');
    }

    if (!scopeCovers(verified.scopes, 'profile:uid')) {
      throw fxaErrors.invalidScopes('profile');
    }

    const { user } = verified;

    const profile: IProfile = {
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      avatar: publicUrl(this.configService, '/profile/v1/avatar/default'),
      avatarDefault: true,
      locale: user.locale ?? 'en-US',
      amrValues: ['pwd', 'email'],
      twoFactorAuthentication: false,
    };

    const etag = `"${createHash('sha256').update(JSON.stringify(profile)).digest('base64url')}"`;
    response.setHeader('ETag', etag);

    if (ifNoneMatch === etag) {
      response.status(304);
      return undefined;
    }

    return profile;
  }

  @Get('avatar/default')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=86400')
  defaultAvatar(): string {
    return DEFAULT_AVATAR_SVG;
  }
}
