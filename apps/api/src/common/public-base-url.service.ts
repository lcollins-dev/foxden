import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service';

const DEFAULT_PORTS: Partial<Record<string, number>> = { 'http:': 80, 'https:': 443 };

/**
 * The origin Firefox reaches the server on, behind any reverse proxy. The tokenserver hands out storage URLs under
 * it and Hawk verifies requests against it, so the two always agree.
 */
@Injectable()
export class PublicBaseUrlService {
  /** No trailing slash. */
  readonly url: string;

  /** Lowercase, as Firefox signs it. */
  readonly host: string;

  readonly port: number;

  /** The path the proxy publishes the server under, `''` at the root; the app sees paths without it. */
  readonly pathPrefix: string;

  constructor(configService: ConfigService) {
    const parsed = new URL(configService.webAppBaseUrl);
    const defaultPort = DEFAULT_PORTS[parsed.protocol];

    if (defaultPort === undefined) {
      throw new Error('The public base URL must be http or https');
    }

    this.pathPrefix = parsed.pathname.replace(/\/+$/, '');
    this.url = `${parsed.origin}${this.pathPrefix}`;
    this.host = parsed.hostname.toLowerCase();
    this.port = parsed.port === '' ? defaultPort : Number(parsed.port);
  }
}
