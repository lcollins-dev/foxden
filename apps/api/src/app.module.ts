import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';

import { SERVER_PATH_PREFIXES } from '@libs/dto';

import { ConfigService } from './config/config.service';

import { ApiModule } from './api/api.module';
import { ConfigModule } from './config/config.module';
import { BackupModule } from './core/backup/backup.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { EntryPointModule } from './entry-point/entry-point.module';
import { FirefoxModule } from './firefox/firefox.module';
import { LoggerModule } from './logger/logger.module';

// serve-static tests `path + '/'`, so `/token/{*path}` covers `/token` too. An excluded path with no api route gets
// Nest's JSON 404 rather than the web app.
const WEB_EXCLUDED_PATHS = SERVER_PATH_PREFIXES.map(prefix => `${prefix}/{*path}`);

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    EmailModule,
    EntryPointModule,
    ApiModule,
    FirefoxModule,
    BackupModule,
    ServeStaticModule.forRootAsync({
      useFactory: (configService: ConfigService) =>
        configService.webRootPath === ''
          ? []
          : [
              {
                rootPath: configService.webRootPath,
                exclude: WEB_EXCLUDED_PATHS,
              },
            ],
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
