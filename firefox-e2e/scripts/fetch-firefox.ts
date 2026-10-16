import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';

import { FETCHED_FIREFOX_BINARY, FIREFOX_DIR, FIREFOX_DOWNLOAD, FIREFOX_VERSION } from '../src/paths.ts';
import { download } from './download.ts';

async function main(): Promise<void> {
  if (platform() !== 'linux' || arch() !== 'x64') {
    throw new Error(`The Firefox fetch supports Linux x64 only, not ${platform()}/${arch()}: set FIREFOX_BINARY`);
  }

  if (existsSync(FETCHED_FIREFOX_BINARY)) {
    console.log(`Firefox ${FIREFOX_VERSION} already at ${FETCHED_FIREFOX_BINARY}`);
    return;
  }

  mkdirSync(FIREFOX_DIR, { recursive: true });

  // Inside FIREFOX_DIR, so the final rename stays on one filesystem.
  const workDir = mkdtempSync(join(FIREFOX_DIR, 'fetch-'));

  try {
    const archive = join(workDir, `firefox-${FIREFOX_VERSION}.tar.xz`);
    await download(FIREFOX_DOWNLOAD, archive);
    execFileSync('tar', ['-xJf', archive, '-C', workDir]);

    const target = join(FIREFOX_DIR, FIREFOX_VERSION);

    // A version folder without its binary is a broken install.
    if (!existsSync(FETCHED_FIREFOX_BINARY)) {
      rmSync(target, { recursive: true, force: true });
    }

    try {
      renameSync(join(workDir, 'firefox'), target);
    } catch (error) {
      // Another worktree's fetch finished first.
      if (!existsSync(FETCHED_FIREFOX_BINARY)) {
        throw error;
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(execFileSync(FETCHED_FIREFOX_BINARY, ['--version']).toString().trim());
}

await main();
