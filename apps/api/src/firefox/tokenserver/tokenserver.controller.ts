import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { ITokenResponse, TokenExchangeService } from './token-exchange.service';

const firstValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** `identity.sync.tokenserver.uri` points Firefox at `<public base url>/token/1.0/sync/1.5`. */
@Controller('token')
export class TokenserverController {
  constructor(private readonly tokenExchangeService: TokenExchangeService) {}

  @Get('1.0/:application/:version')
  async getToken(
    @Param('application', new FxaZodPipe(z.string())) application: string,
    @Param('version', new FxaZodPipe(z.string())) version: string,
    @Headers('authorization') authorization: unknown,
    @Headers('x-keyid') keyId: unknown,
    @Headers('x-client-state') clientState: unknown,
    @Query('duration', new FxaZodPipe(z.unknown())) duration: unknown,
    @Res({ passthrough: true }) res: Response
  ): Promise<ITokenResponse> {
    const token = await this.tokenExchangeService.exchange({
      application,
      version,
      authorization: firstValue(authorization),
      keyId: firstValue(keyId),
      clientState: firstValue(clientState),
      duration: firstValue(duration),
    });

    res.setHeader('X-Timestamp', String(Math.floor(Date.now() / 1000)));

    return token;
  }
}
