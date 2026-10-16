import { Type } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { ConfigService } from './config/config.service';

import { AppModule } from './app.module';

import { useRequestBodyParsers } from './entry-point/request-body-parser';
import { RequestExceptionFilter } from './entry-point/request-exception.filter';
import { useResponseHeaders } from './entry-point/response-headers';

export const createApp = async (rootModule: Type = AppModule): Promise<NestExpressApplication> => {
  initializeTransactionalContext();

  // Nest exits the process itself on a provider that throws unless this is off, which would take
  // the bootstrap error handling in main.ts with it.
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(PinoLogger));

  return app;
};

export const applyGlobalMiddleware = (app: NestExpressApplication): void => {
  // The throttler keys on req.ip, which is the proxy's address unless the proxy is trusted to name the client.
  app.set('trust proxy', app.get(ConfigService).trustProxy);

  useResponseHeaders(app);
  useRequestBodyParsers(app);

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.useGlobalFilters(new RequestExceptionFilter(httpAdapter));
};
