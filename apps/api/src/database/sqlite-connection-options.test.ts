import { Logger } from '@nestjs/common';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sqliteConnectionOptions } from './sqlite-connection-options';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, chmodSync: vi.fn(actual.chmodSync) };
});

describe('sqliteConnectionOptions', () => {
  let directory: string;
  let databasePath: string;

  const prepare = () => sqliteConnectionOptions(databasePath).prepareDatabase?.(undefined);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'foxden-sqlite-options-'));
    databasePath = join(directory, 'foxden.sqlite');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('warns and carries on when a file belongs to another user', () => {
    writeFileSync(databasePath, '', { mode: 0o644 });
    vi.mocked(chmodSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(prepare).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: databasePath }),
      'restrictAccess(): Could not make the database file private to the server'
    );
  });
});
