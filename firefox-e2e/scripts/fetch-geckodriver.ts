import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import { GECKODRIVER_PATH, GECKODRIVER_VERSION } from '../src/paths.ts';

function releaseAssetName(): string {
  const os = platform();
  const cpu = arch();

  if (os === 'linux') {
    return cpu === 'arm64' ? 'linux-aarch64' : 'linux64';
  }

  if (os === 'darwin') {
    return cpu === 'arm64' ? 'macos-aarch64' : 'macos';
  }

  throw new Error(`Unsupported platform ${os}/${cpu}: fetch geckodriver ${GECKODRIVER_VERSION} by hand`);
}

async function main(): Promise<void> {
  const versionFile = `${GECKODRIVER_PATH}.version`;

  if (existsSync(GECKODRIVER_PATH) && existsSync(versionFile)) {
    if (readFileSync(versionFile, 'utf8').trim() === GECKODRIVER_VERSION) {
      return;
    }
  }

  const asset = `geckodriver-v${GECKODRIVER_VERSION}-${releaseAssetName()}.tar.gz`;
  const url = `https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/${asset}`;
  console.log(`Downloading ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }

  const archive = join(tmpdir(), asset);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  const binDir = join(GECKODRIVER_PATH, '..');
  mkdirSync(binDir, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', binDir]);
  rmSync(archive);
  writeFileSync(versionFile, `${GECKODRIVER_VERSION}\n`);

  console.log(execFileSync(GECKODRIVER_PATH, ['--version']).toString().split('\n')[0]);
}

await main();
