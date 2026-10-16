import { ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerModule } from '@nestjs/throttler';

import { ClientThrottlerGuard } from './client-throttler.guard';
import { RequestAuthGuard } from './request-auth.guard';
import { RequestSurfaceGuard } from './request-surface.guard';
import { AuthGuard } from '@/api/v1/user/guards/auth.guard';

import { ConfigService } from '@/config/config.service';

import { SessionModule } from '@/core/session/session.module';

import { ISurfacedRequest, RequestSurface } from './request-surface';

const isUnthrottled = (context: ExecutionContext): boolean => {
  const { surface } = context.switchToHttp().getRequest<ISurfacedRequest>();

  return surface === RequestSurface.TOKENSERVER || surface === RequestSurface.STORAGE;
};

/**
 * The policies that differ between the management API and the Firefox surfaces, each chosen by the path prefix a
 * request arrived on. Nest has no module-scoped guard or filter, so each is global and dispatches.
 */
@Module({
  imports: [
    SessionModule,
    ThrottlerModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: seconds(configService.rateLimitWindowSecs),
            limit: configService.rateLimitMaxRequests,
            skipIf: isUnthrottled,
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthGuard,
    // Global guards run in the order they are provided: the stamp first, then the throttle counts a request before it
    // is authenticated.
    { provide: APP_GUARD, useClass: RequestSurfaceGuard },
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    { provide: APP_GUARD, useClass: RequestAuthGuard },
  ],
})
export class EntryPointModule {}
