import { Controller, Get } from '@nestjs/common';
import ms from 'ms';

import { ServerInfoResponseDto } from '@libs/dto';

import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';

import { ConfigService } from '@/config/config.service';

import { publicUrl } from '@/common/public-url';

@NoAuth()
@Controller('api/v1/server')
export class ServerController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getServerInfo(): ServerInfoResponseDto {
    return {
      publicUrl: publicUrl(this.configService),
      inviteLifetimeMs: ms(this.configService.inviteExpiry),
    };
  }
}
