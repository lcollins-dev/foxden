import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ANDROID_API_LEVEL,
  ANDROID_AVD_DIR,
  ANDROID_AVD_NAME,
  ANDROID_DOWNLOADS,
  ANDROID_SDK_DIR,
  ANDROID_TOOLS_DIR,
  FENIX_APK_PATH,
  type ISdkPackage,
} from '../src/paths.ts';
import { download } from './download.ts';

async function install(item: ISdkPackage): Promise<void> {
  const installed = join(ANDROID_SDK_DIR, item.installPath);
  const marker = join(installed, '.foxden-sha256');

  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === item.sha256) {
    return;
  }

  const archive = join(ANDROID_TOOLS_DIR, 'downloads', item.url.split('/').pop() ?? 'archive.zip');
  await download(item, archive);

  const unpackDir = join(ANDROID_TOOLS_DIR, 'unpack');
  rmSync(unpackDir, { recursive: true, force: true });
  mkdirSync(unpackDir, { recursive: true });
  execFileSync('unzip', ['-q', archive, '-d', unpackDir]);

  rmSync(installed, { recursive: true, force: true });
  mkdirSync(dirname(installed), { recursive: true });
  renameSync(join(unpackDir, item.archiveRoot), installed);
  rmSync(unpackDir, { recursive: true, force: true });
  rmSync(archive);

  writeFileSync(marker, `${item.sha256}\n`);
}

/** What `avdmanager create avd` writes, so the setup needs no Java. */
function createAvd(): void {
  const avdPath = join(ANDROID_AVD_DIR, `${ANDROID_AVD_NAME}.avd`);

  mkdirSync(avdPath, { recursive: true });

  writeFileSync(
    join(ANDROID_AVD_DIR, `${ANDROID_AVD_NAME}.ini`),
    [
      `avd.ini.encoding=UTF-8`,
      `path=${avdPath}`,
      `path.rel=avd/${ANDROID_AVD_NAME}.avd`,
      `target=android-${ANDROID_API_LEVEL}`,
      '',
    ].join('\n')
  );

  writeFileSync(
    join(avdPath, 'config.ini'),
    [
      'avd.ini.encoding=UTF-8',
      'abi.type=x86_64',
      'hw.cpu.arch=x86_64',
      'hw.cpu.ncore=4',
      'hw.ramSize=4096',
      'hw.lcd.width=1080',
      'hw.lcd.height=2400',
      'hw.lcd.density=420',
      'hw.keyboard=yes',
      'hw.gpu.enabled=yes',
      'hw.gpu.mode=swangle_indirect',
      'disk.dataPartition.size=6G',
      `image.sysdir.1=system-images/android-${ANDROID_API_LEVEL}/default/x86_64/`,
      'tag.id=default',
      `target=android-${ANDROID_API_LEVEL}`,
      '',
    ].join('\n')
  );
}

async function main(): Promise<void> {
  if (platform() !== 'linux' || arch() !== 'x64') {
    throw new Error(`The Android emulator setup supports Linux x64 only, not ${platform()}/${arch()}`);
  }

  if (!existsSync('/dev/kvm')) {
    throw new Error('The emulator needs /dev/kvm');
  }

  for (const item of ANDROID_DOWNLOADS.sdk) {
    await install(item);
  }

  if (!existsSync(FENIX_APK_PATH)) {
    await download(ANDROID_DOWNLOADS.firefox, FENIX_APK_PATH);
  }

  createAvd();

  console.log(`Android tools ready in ${ANDROID_TOOLS_DIR}`);
}

await main();
