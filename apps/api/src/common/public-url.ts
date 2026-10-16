import { ConfigService } from '@/config/config.service';

/** An absolute URL on the public origin (WEB_APP_BASE_URL), which the TLS-terminating proxy serves. */
export function publicUrl(configService: ConfigService, path = ''): string {
  return `${configService.webAppBaseUrl.replace(/\/+$/, '')}${path}`;
}
