import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// From 0.37.1 chrome context needs geckodriver's `--allow-system-access`; Firefox's own flag is rejected in args.
export const GECKODRIVER_VERSION = '0.37.1';

export const PACKAGE_ROOT = join(import.meta.dirname, '..');

export const GECKODRIVER_PATH = join(PACKAGE_ROOT, '.bin', 'geckodriver');

export const ARTIFACTS_DIR = join(PACKAGE_ROOT, '.artifacts');

/**
 * The fetched desktop Firefox, and the Android SDK, emulator image and Firefox for Android, live in the main checkout's
 * `firefox-e2e`, so every worktree shares the one copy. `ANDROID_TOOLS_DIR` moves the Android tools (about 4 GB).
 */
function mainCheckoutPackageRoot(): string {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
    }).trim();

    return join(dirname(commonDir), 'firefox-e2e');
  } catch {
    return PACKAGE_ROOT;
  }
}

const MAIN_CHECKOUT_PACKAGE_ROOT = mainCheckoutPackageRoot();

export const FIREFOX_VERSION = '157.0';

/** The sha256 is the release's line in https://archive.mozilla.org/pub/firefox/releases/<version>/SHA256SUMS. */
export const FIREFOX_DOWNLOAD = {
  url: `https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/en-US/firefox-${FIREFOX_VERSION}.tar.xz`,
  sha256: '42f2c62a562316982ef5a796738c57602bf84a984f5c616e80bcff4627f78fff',
} satisfies IDownload;

export const FIREFOX_DIR = join(MAIN_CHECKOUT_PACKAGE_ROOT, '.firefox');

export const FETCHED_FIREFOX_BINARY = join(FIREFOX_DIR, FIREFOX_VERSION, 'firefox');

export const ANDROID_TOOLS_DIR = process.env.ANDROID_TOOLS_DIR ?? join(MAIN_CHECKOUT_PACKAGE_ROOT, '.android');

export const ANDROID_SDK_DIR = join(ANDROID_TOOLS_DIR, 'sdk');

export const ANDROID_AVD_DIR = join(ANDROID_TOOLS_DIR, 'avd');

/** HOME for adb and the emulator, which otherwise write keys and state to `~/.android`. */
export const ANDROID_HOME_DIR = join(ANDROID_TOOLS_DIR, 'home');

export const ANDROID_AVD_NAME = 'foxden';

export const ANDROID_API_LEVEL = 35;

export const FENIX_VERSION = '157.0';

export const FENIX_PACKAGE = 'org.mozilla.firefox';

export const FENIX_APK_PATH = join(ANDROID_TOOLS_DIR, 'apk', `fenix-${FENIX_VERSION}.multi.android-x86_64.apk`);

export interface IDownload {
  url: string;
  sha256: string;
}

export interface ISdkPackage extends IDownload {
  archiveRoot: string;
  installPath: string;
}

const GOOGLE_REPOSITORY = 'https://dl.google.com/android/repository';

/** Stable channel of Google's repository2-3.xml and sys-img2-3.xml; the SHA-1s there match these SHA-256s. */
export const ANDROID_DOWNLOADS = {
  sdk: [
    {
      url: `${GOOGLE_REPOSITORY}/platform-tools_r37.0.1-linux.zip`,
      sha256: 'd230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1',
      archiveRoot: 'platform-tools',
      installPath: 'platform-tools',
    },
    {
      url: `${GOOGLE_REPOSITORY}/emulator-linux_x64-15917651.zip`,
      sha256: '95771e0ae431897b2a4bd2d97fa095f29a8b0624a7b216baf529f9306161c266',
      archiveRoot: 'emulator',
      installPath: 'emulator',
    },
    {
      url: `${GOOGLE_REPOSITORY}/sys-img/android/x86_64-${ANDROID_API_LEVEL}_r02.zip`,
      sha256: '6dd7de33e63ef105cf2fabea6badda1dbe7665c96d8908e5f6e1407e63ff4556',
      archiveRoot: 'x86_64',
      installPath: `system-images/android-${ANDROID_API_LEVEL}/default/x86_64`,
    },
  ] satisfies ISdkPackage[],
  firefox: {
    url: `https://archive.mozilla.org/pub/fenix/releases/${FENIX_VERSION}/android/fenix-${FENIX_VERSION}-android-x86_64/fenix-${FENIX_VERSION}.multi.android-x86_64.apk`,
    sha256: '85cbd0d56c571b7eec8e34a76a4edebac713aec773491d41c6a5915beb2f9354',
  } satisfies IDownload,
};
