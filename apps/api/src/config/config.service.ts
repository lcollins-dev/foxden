import { type IEnvConfig, parseEnvironment, SECRETS } from './config.schema';

export class ConfigService {
  private readonly env: IEnvConfig;

  constructor() {
    this.env = parseEnvironment();
  }

  /** The validated settings with every secret masked, safe to log. */
  get loggable(): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...this.env };

    for (const secret of SECRETS) {
      masked[secret] = '[redacted]';
    }

    return masked;
  }

  // General
  get version() {
    return this.env.VERSION;
  }

  get nodeEnv() {
    return this.env.NODE_ENV;
  }

  get port() {
    return this.env.PORT;
  }

  get webAppBaseUrl() {
    return this.env.WEB_APP_BASE_URL;
  }

  get webRootPath() {
    return this.env.WEB_ROOT_PATH;
  }

  get blockedAtEnabled() {
    return this.env.BLOCKED_AT_ENABLED;
  }

  get blockedAtThresholdMs() {
    return this.env.BLOCKED_AT_THRESHOLD_MS;
  }

  get pageSize() {
    return this.env.PAGE_SIZE;
  }

  /**
   * Express reads a number as a hop count, a boolean as trusting every hop or none, and a string as a list of
   * addresses, subnets and preset names. It refuses `true` and `false` as strings, so they go through as booleans.
   */
  get trustProxy(): boolean | number | string {
    const setting = this.env.TRUST_PROXY.trim();

    if (/^\d+$/.test(setting)) {
      return Number(setting);
    }

    if (setting === 'true' || setting === 'false') {
      return setting === 'true';
    }

    return setting;
  }

  // Logs
  get logStdoutLevel() {
    return this.env.LOG_STDOUT_LEVEL;
  }

  get logStdoutPretty() {
    return this.env.LOG_STDOUT_PRETTY;
  }

  get logFileLevel() {
    return this.env.LOG_FILE_LEVEL;
  }

  get logFilePretty() {
    return this.env.LOG_FILE_PRETTY;
  }

  get logFilePath() {
    return this.env.LOG_FILE_PATH;
  }

  get logFileName() {
    return this.env.LOG_FILE_NAME;
  }

  get logFileRotateInterval() {
    return this.env.LOG_FILE_ROTATE_INTERVAL;
  }

  get logFileRotateMaxSize() {
    return this.env.LOG_FILE_ROTATE_MAX_SIZE;
  }

  get logFileRotateMaxFiles() {
    return this.env.LOG_FILE_ROTATE_MAX_FILES;
  }

  // Email
  get emailTemplatesPath() {
    return this.env.EMAIL_TEMPLATES_PATH;
  }

  get emailFromAddress() {
    return this.env.EMAIL_FROM_ADDRESS;
  }

  get emailSmtpHost() {
    return this.env.EMAIL_SMTP_HOST;
  }

  get emailSmtpPort() {
    return this.env.EMAIL_SMTP_PORT;
  }

  get emailSmtpUsername() {
    return this.env.EMAIL_SMTP_USERNAME;
  }

  get emailSmtpPassword() {
    return this.env.EMAIL_SMTP_PASSWORD;
  }

  get emailSmtpSecure() {
    return this.env.EMAIL_SMTP_SECURE;
  }

  get emailSmtpStarttls() {
    return this.env.EMAIL_SMTP_STARTTLS;
  }

  // Database
  get databasePath() {
    return this.env.DATABASE_PATH;
  }

  get typeormMigrationsRun() {
    return this.env.TYPEORM_MIGRATIONS_RUN;
  }

  get typeormLogging() {
    return this.env.TYPEORM_LOGGING;
  }

  get useTestMigrations() {
    return this.env.USE_TEST_MIGRATIONS;
  }

  // Backups
  get backupPath() {
    return this.env.BACKUP_PATH;
  }

  get backupRetention() {
    return this.env.BACKUP_RETENTION;
  }

  // Rate limiting
  get rateLimitWindowSecs() {
    return this.env.RATE_LIMIT_WINDOW_SECS;
  }

  get rateLimitMaxRequests() {
    return this.env.RATE_LIMIT_MAX_REQUESTS;
  }

  // Requests
  get requestMaxSizeJson() {
    return this.env.REQUEST_MAX_SIZE_JSON;
  }

  // Invites
  get inviteExpiry() {
    return this.env.INVITE_EXPIRY;
  }

  // Password resets
  get passwordResetExpiry() {
    return this.env.PASSWORD_RESET_EXPIRY;
  }

  // Sessions
  get sessionWithoutDeviceExpiry() {
    return this.env.SESSION_WITHOUT_DEVICE_EXPIRY;
  }

  // Batch jobs
  get batchJobRunHistorySize() {
    return this.env.BATCH_JOB_RUN_HISTORY_SIZE;
  }

  get batchJobPurgeExpiredSyncDataCron() {
    return this.env.BATCH_JOB_PURGE_EXPIRED_SYNC_DATA_CRON;
  }

  get batchJobPurgeExpiredSessionsCron() {
    return this.env.BATCH_JOB_PURGE_EXPIRED_SESSIONS_CRON;
  }

  get batchJobBackupDatabaseCron() {
    return this.env.BATCH_JOB_BACKUP_DATABASE_CRON;
  }
}
