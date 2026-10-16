import { Controller, Get } from '@nestjs/common';

import { ConfigService } from '@/config/config.service';

import { publicUrl } from '@/common/public-url';

export interface IFxaClientConfiguration {
  auth_server_base_url: string;
  oauth_server_base_url: string;
  profile_server_base_url: string;
  sync_tokenserver_base_url: string;
}

/** Discovery documents, with absolute URLs on the public origin. */
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Firefox autoconfig (ff/services/fxaccounts/FxAccountsConfig.sys.mjs updateConfigURLs). Firefox appends `/v1` to
   * the auth URL unless present and always to the OAuth and profile URLs, and `/1.0/sync/1.5` to the tokenserver's, so
   * none of these may end in `/` or `/v1`.
   */
  @Get('fxa-client-configuration')
  fxaClientConfiguration(): IFxaClientConfiguration {
    return {
      auth_server_base_url: publicUrl(this.configService, '/auth'),
      oauth_server_base_url: publicUrl(this.configService, '/oauth'),
      profile_server_base_url: publicUrl(this.configService, '/profile'),
      sync_tokenserver_base_url: publicUrl(this.configService, '/token'),
    };
  }

  /** OpenID discovery; the mobile clients read the endpoints from it. `/authorization` is a web UI page. */
  @Get('openid-configuration')
  openidConfiguration(): Record<string, unknown> {
    return {
      issuer: publicUrl(this.configService),
      authorization_endpoint: publicUrl(this.configService, '/authorization'),
      token_endpoint: publicUrl(this.configService, '/oauth/v1/token'),
      userinfo_endpoint: publicUrl(this.configService, '/profile/v1/profile'),
      introspection_endpoint: publicUrl(this.configService, '/oauth/v1/introspect'),
      revocation_endpoint: publicUrl(this.configService, '/oauth/v1/destroy'),
      jwks_uri: publicUrl(this.configService, '/oauth/v1/jwks'),
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['profile', 'https://identity.mozilla.com/apps/oldsync'],
      claims_supported: ['aud', 'exp', 'iat', 'iss', 'sub'],
    };
  }
}
