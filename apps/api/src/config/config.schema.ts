import { existsSync } from 'node:fs';
import { z } from 'zod';

import { cron, duration, flag, integer, text } from './config.builders';

export enum NodeEnv {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

/** Keyed by the variable each setting is read from, so a rejected value names itself. */
const environment = z.object({
  // General
  VERSION: text('dev'),

  NODE_ENV: z.enum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  PORT: integer(3000),

  WEB_APP_BASE_URL: z.string().min(1),

  // Blank leaves the built web app unserved, as in development where Vite serves it.
  WEB_ROOT_PATH: z.string().default(''),

  BLOCKED_AT_ENABLED: flag(false),
  BLOCKED_AT_THRESHOLD_MS: integer(1000),

  PAGE_SIZE: integer(20, 1),

  TRUST_PROXY: text('loopback, linklocal, uniquelocal'),

  // Logs
  LOG_STDOUT_LEVEL: text('info'),
  LOG_STDOUT_PRETTY: flag(true),

  LOG_FILE_LEVEL: text('info'),
  LOG_FILE_PRETTY: flag(true),
  // Blank turns file logging off.
  LOG_FILE_PATH: z.string().default('logs'),
  LOG_FILE_NAME: text('all.log'),
  LOG_FILE_ROTATE_INTERVAL: text('1d'),
  LOG_FILE_ROTATE_MAX_SIZE: text('10M'),
  LOG_FILE_ROTATE_MAX_FILES: integer(5, 1),

  // Database
  DATABASE_PATH: text('data/foxden.sqlite'),
  TYPEORM_LOGGING: flag(false),
  TYPEORM_MIGRATIONS_RUN: flag(false),

  USE_TEST_MIGRATIONS: flag(false),

  // Backups
  BACKUP_PATH: text('data/backups'),
  BACKUP_RETENTION: integer(7, 1),

  // Email
  EMAIL_TEMPLATES_PATH: text('email-templates'),

  EMAIL_FROM_ADDRESS: text('foxden@localhost'),

  // Blank turns sending off.
  EMAIL_SMTP_HOST: z.string().default(''),
  EMAIL_SMTP_PORT: integer(587),
  EMAIL_SMTP_USERNAME: z.string().default(''),
  EMAIL_SMTP_PASSWORD: z.string().default(''),
  // Implicit TLS, as on port 465. Port 587 expects false and STARTTLS.
  EMAIL_SMTP_SECURE: flag(false),
  EMAIL_SMTP_STARTTLS: flag(true),

  // Rate limiting
  RATE_LIMIT_WINDOW_SECS: integer(5, 1),
  RATE_LIMIT_MAX_REQUESTS: integer(50, 1),

  // Requests
  REQUEST_MAX_SIZE_JSON: text('8mb'),

  // Invites
  INVITE_EXPIRY: duration('7d'),

  // Password resets
  PASSWORD_RESET_EXPIRY: duration('1d'),

  // Sessions
  // 0 turns expiry off.
  SESSION_WITHOUT_DEVICE_EXPIRY: duration('1d'),

  // Batch jobs
  BATCH_JOB_RUN_HISTORY_SIZE: integer(100, 1),

  BATCH_JOB_PURGE_EXPIRED_SYNC_DATA_CRON: cron('17 * * * *'),
  BATCH_JOB_PURGE_EXPIRED_SESSIONS_CRON: cron('47 * * * *'),
  BATCH_JOB_BACKUP_DATABASE_CRON: cron('23 3 * * *'),
});

export type IEnvConfig = z.infer<typeof environment>;

/** Settings whose value never reaches a log or an error message. */
export const SECRETS: readonly (keyof IEnvConfig)[] = ['EMAIL_SMTP_PASSWORD'];

/** Reads `<NODE_ENV>.env` into `process.env`, leaving any variable already set. A missing file is accepted. */
function loadEnvFile(nodeEnv: string): void {
  const path = `${nodeEnv}.env`;

  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function configError(issues: readonly z.core.$ZodIssue[]): ConfigError {
  const reasons = issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');

  return new ConfigError(`Config validation error: ${reasons}`);
}

/** Loads the env file, then validates the environment or names every setting it rejected. */
export function parseEnvironment(): IEnvConfig {
  loadEnvFile(process.env.NODE_ENV ?? NodeEnv.DEVELOPMENT);

  const validated = environment.safeParse(process.env);

  if (!validated.success) {
    throw configError(validated.error.issues);
  }

  return validated.data;
}
