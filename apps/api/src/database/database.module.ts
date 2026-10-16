import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { addTransactionalDataSource } from 'typeorm-transactional';

import { ConfigService } from '../config/config.service';

import { ConfigModule } from '../config/config.module';

import { gateDataSource } from './gated-data-source';
import { migrations, testMigrations } from './migrations';
import { sqliteConnectionOptions } from './sqlite-connection-options';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        ...sqliteConnectionOptions(configService.databasePath),
        logging: configService.typeormLogging,
        autoLoadEntities: true,
        entitySkipConstructor: true,
        migrations: configService.useTestMigrations ? [...migrations, ...testMigrations] : migrations,
        migrationsRun: configService.typeormMigrationsRun,
      }),
      dataSourceFactory(options) {
        if (!options) {
          throw new Error('Invalid options passed');
        }

        return Promise.resolve(addTransactionalDataSource(gateDataSource(new DataSource(options))));
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
