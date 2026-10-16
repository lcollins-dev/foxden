import { NestExpressApplication } from '@nestjs/platform-express';
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { SigningKeyService } from '@/core/oauth/signing-key.service';

import { useAppSigningKey } from './utils/access-token';
import { applyGlobalMiddleware, createApp } from '@/app';

let sharedApp: Promise<NestExpressApplication> | undefined;

/** Points this worker at its own copy of the database the global setup migrated, and its own backup directory. */
const useWorkerDatabase = (): void => {
  const template = process.env.INTEGRATION_DATABASE_TEMPLATE;

  if (template === undefined) {
    throw new Error('INTEGRATION_DATABASE_TEMPLATE is not set - run the suite through vitest.integration.config.ts');
  }

  const worker = join(dirname(template), `worker-${process.env.VITEST_POOL_ID ?? '0'}`);
  const databasePath = `${worker}.sqlite`;
  copyFileSync(template, databasePath);

  process.env.DATABASE_PATH = databasePath;
  process.env.BACKUP_PATH = `${worker}-backups`;
};

/** One app per worker, shared by every spec in it. */
export const bootstrapApp = async (): Promise<NestExpressApplication> => {
  sharedApp ??= (async () => {
    useWorkerDatabase();

    const app = await createApp();

    applyGlobalMiddleware(app);

    await app.init();

    useAppSigningKey(app.get(SigningKeyService).getActiveKey());

    return app;
  })();

  return sharedApp;
};
