import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from './config.service';

describe('ConfigService', () => {
  beforeEach(() => {
    vi.stubEnv('WEB_APP_BASE_URL', 'http://localhost:8080');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('trustProxy', () => {
    const trustProxy = (setting: string | undefined): boolean | number | string => {
      vi.stubEnv('TRUST_PROXY', setting);

      return new ConfigService().trustProxy;
    };

    it('reads an all-digit setting as a hop count', () => {
      expect(trustProxy('2')).toBe(2);
    });

    it('reads 0 as trusting no hop', () => {
      expect(trustProxy('0')).toBe(0);
    });

    it('trims the setting before reading it', () => {
      expect(trustProxy(' 1 ')).toBe(1);
    });

    it('reads true and false as booleans, which Express refuses as strings', () => {
      expect(trustProxy('true')).toBe(true);
      expect(trustProxy('false')).toBe(false);
    });

    it('passes a list of addresses and preset names on as a string', () => {
      expect(trustProxy('loopback, 192.0.2.0/24')).toBe('loopback, 192.0.2.0/24');
    });

    it('trusts loopback and the private ranges by default', () => {
      expect(trustProxy(undefined)).toBe('loopback, linklocal, uniquelocal');
    });
  });

  describe('sessionWithoutDeviceExpiry', () => {
    it('defaults to 1 day', () => {
      expect(new ConfigService().sessionWithoutDeviceExpiry).toBe('1d');
    });

    it('accepts 0 and a span with a unit', () => {
      for (const setting of ['0', '30d', '12 hours']) {
        vi.stubEnv('SESSION_WITHOUT_DEVICE_EXPIRY', setting);

        expect(new ConfigService().sessionWithoutDeviceExpiry).toBe(setting);
      }
    });

    it('refuses a number without a unit, which ms would read as milliseconds', () => {
      vi.stubEnv('SESSION_WITHOUT_DEVICE_EXPIRY', '30');

      expect(() => new ConfigService()).toThrow(/SESSION_WITHOUT_DEVICE_EXPIRY: must be a duration with a unit/);
    });
  });

  describe('batch job schedules', () => {
    it('run each purge hourly by default, at different minutes', () => {
      const config = new ConfigService();

      expect(config.batchJobPurgeExpiredSyncDataCron).toBe('17 * * * *');
      expect(config.batchJobPurgeExpiredSessionsCron).toBe('47 * * * *');
    });

    it('back the database up daily by default', () => {
      expect(new ConfigService().batchJobBackupDatabaseCron).toBe('23 3 * * *');
    });

    it('refuses a schedule that is not a cron expression', () => {
      vi.stubEnv('BATCH_JOB_PURGE_EXPIRED_SESSIONS_CRON', 'hourly');

      expect(() => new ConfigService()).toThrow(/BATCH_JOB_PURGE_EXPIRED_SESSIONS_CRON: must be a cron expression/);
    });
  });

  describe('batch job run history size', () => {
    it('keeps 100 runs per job by default', () => {
      expect(new ConfigService().batchJobRunHistorySize).toBe(100);
    });

    it('refuses a size below one', () => {
      vi.stubEnv('BATCH_JOB_RUN_HISTORY_SIZE', '0');

      expect(() => new ConfigService()).toThrow(/BATCH_JOB_RUN_HISTORY_SIZE/);
    });
  });

  describe('backups', () => {
    it('keep 7 backups beside the default database by default', () => {
      const config = new ConfigService();

      expect(config.backupPath).toBe('data/backups');
      expect(config.backupRetention).toBe(7);
    });

    it('refuse a retention below 1', () => {
      vi.stubEnv('BACKUP_RETENTION', '0');

      expect(() => new ConfigService()).toThrow(/BACKUP_RETENTION/);
    });
  });
});
