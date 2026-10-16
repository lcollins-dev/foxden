import { Module } from '@nestjs/common';

import { TokenExchangeService } from './token-exchange.service';

import { TokenserverController } from './tokenserver.controller';

import { TokenserverModule } from '@/core/tokenserver/tokenserver.module';

@Module({
  imports: [TokenserverModule],
  providers: [TokenExchangeService],
  controllers: [TokenserverController],
})
export class TokenserverFirefoxModule {}
