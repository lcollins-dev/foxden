import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import {
  ANDROID_AVD_DIR,
  ANDROID_AVD_NAME,
  ANDROID_HOME_DIR,
  ANDROID_SDK_DIR,
  ARTIFACTS_DIR,
  FENIX_APK_PATH,
  FENIX_PACKAGE,
} from './paths.ts';

const execFileAsync = promisify(execFile);

/** Its own adb server port, so a developer's own adb is left alone; the console port must stay in 5554-5584. */
const ADB_SERVER_PORT = '5137';
const EMULATOR_PORT = 5580;
const EMULATOR_SERIAL = `emulator-${EMULATOR_PORT}`;

const ADB = join(ANDROID_SDK_DIR, 'platform-tools', 'adb');
const EMULATOR = join(ANDROID_SDK_DIR, 'emulator', 'emulator');

const APP_DATA = `/data/data/${FENIX_PACKAGE}`;

/** Firefox for Android logs this once at the end of each sync run that gets as far as syncing. */
const SYNC_FINISHED = 'Sync finished with status';

/** `uiautomator dump` fails on /sdcard while the emulator's storage is still settling. */
const UI_DUMP = '/data/local/tmp/foxden-ui.xml';

function androidEnv(): NodeJS.ProcessEnv {
  mkdirSync(ANDROID_HOME_DIR, { recursive: true });

  // HOME too, so nothing lands in the developer's own ~/.android.
  return {
    ...process.env,
    HOME: ANDROID_HOME_DIR,
    ANDROID_HOME: ANDROID_SDK_DIR,
    ANDROID_SDK_ROOT: ANDROID_SDK_DIR,
    ANDROID_USER_HOME: join(ANDROID_HOME_DIR, '.android'),
    ANDROID_EMULATOR_HOME: join(ANDROID_HOME_DIR, '.android'),
    ANDROID_AVD_HOME: ANDROID_AVD_DIR,
    ANDROID_ADB_SERVER_PORT: ADB_SERVER_PORT,
  };
}

async function adb(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(ADB, ['-s', EMULATOR_SERIAL, ...args], {
    env: androidEnv(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });

  return stdout;
}

async function shell(command: string): Promise<string> {
  return adb('shell', command);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
  intervalMs = 1000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      const value = await probe();

      if (value !== null && value !== undefined && value !== false) {
        return value;
      }
    } catch (error) {
      lastError = String(error);
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${what}${lastError === null ? '' : `: ${lastError}`}`);
}

export interface IEmulator {
  logFile: string;
  stop(): Promise<void>;
}

/** Boots the AVD from a wiped data partition, so every run starts from a fresh install. */
export async function startEmulator({ headless = true }: { headless?: boolean } = {}): Promise<IEmulator> {
  if (!existsSync(EMULATOR)) {
    throw new Error('Run `npm run fetch-android -w firefox-e2e` first');
  }

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const logFile = join(ARTIFACTS_DIR, 'android-emulator.log');
  const log = createWriteStream(logFile);

  const args = [
    '-avd',
    ANDROID_AVD_NAME,
    '-port',
    String(EMULATOR_PORT),
    '-wipe-data',
    '-no-snapshot',
    '-no-audio',
    '-no-boot-anim',
    '-gpu',
    'swangle_indirect',
    ...(headless ? ['-no-window'] : []),
  ];

  const child: ChildProcess = spawn(EMULATOR, args, { env: androidEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);

  const stop = async () => {
    await adb('emu', 'kill').catch(() => undefined);
    await waitFor(
      'the emulator to exit',
      () => Promise.resolve(child.exitCode !== null || child.signalCode !== null),
      15_000
    );
    await execFileAsync(ADB, ['kill-server'], { env: androidEnv() }).catch(() => undefined);
  };

  try {
    await waitFor(
      'the emulator to boot',
      async () => (await shell('getprop sys.boot_completed')).trim() === '1',
      120_000,
      2000
    );
    await adb('root');
    await waitFor('adb as root', async () => (await shell('id -u')).trim() === '0', 15_000);

    // A sleeping screen stops screenshots and leaves uiautomator dumping the last tree it saw.
    await shell('svc power stayon true && settings put system screen_off_timeout 2147483647');
    await shell('input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard');
  } catch (error) {
    child.kill();
    throw error;
  }

  return { logFile, stop };
}

/**
 * Installs Firefox for Android and writes its preferences before the first launch: onboarding done, the terms
 * accepted, no password-save prompt, and `serverUrl` as the custom Mozilla account server (Sync Debug in
 * fenix/.../settings/SyncDebugFragment.kt). The tokenserver comes from the server's autoconfig.
 */
export async function installFirefox(serverUrl: string): Promise<void> {
  await adb('install', '-r', '-g', FENIX_APK_PATH);

  const { hostname, port } = new URL(serverUrl);

  if (hostname !== 'localhost' || port === '') {
    throw new Error(
      `The Android suite reaches the server through adb reverse, so it needs http://localhost:<port>, not ${serverUrl}`
    );
  }

  await adb('reverse', `tcp:${port}`, `tcp:${port}`);

  const fenixPreferences = [
    `<string name="pref_key_override_fxa_server">${serverUrl}</string>`,
    '<boolean name="pref_key_terms_accepted" value="true" />',
    '<boolean name="pref_key_save_logins" value="false" />',
  ];
  const onboarding = ['<int name="fenix.onboarding.last_version" value="1" />'];

  await writePreferences('fenix_preferences', fenixPreferences);
  await writePreferences('fenix.onboarding', onboarding);
}

async function writePreferences(name: string, entries: string[]): Promise<void> {
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${entries.join('\n')}\n</map>\n`;
  const local = join(ARTIFACTS_DIR, `${name}.xml`);
  const remote = `${APP_DATA}/shared_prefs/${name}.xml`;

  writeFileSync(local, xml);
  await shell(`mkdir -p ${APP_DATA}/shared_prefs`);
  await adb('push', local, remote);

  const uid = (await shell(`stat -c %u ${APP_DATA}`)).trim();
  await shell(
    `chown -R ${uid}:${uid} ${APP_DATA}/shared_prefs && chmod 660 ${remote} && restorecon -R ${APP_DATA}/shared_prefs`
  );
}

export async function stopFirefox(): Promise<void> {
  await shell(`am force-stop ${FENIX_PACKAGE}`);
}

/** Fenix handles `fenix://` deep links (fenix/.../home/intent/HomeDeepLinkIntentProcessor.kt). */
export async function openDeepLink(host: string): Promise<void> {
  await shell(`am start -a android.intent.action.VIEW -d fenix://${host} ${FENIX_PACKAGE}`);
}

export async function openUrl(url: string): Promise<void> {
  await shell(`am start -a android.intent.action.VIEW -d '${url}' ${FENIX_PACKAGE}`);
}

export interface IUiNode {
  text: string;
  resourceId: string;
  className: string;
  centre: { x: number; y: number };
}

/** The accessibility tree, which includes the web content GeckoView renders. */
export async function dumpUi(): Promise<IUiNode[]> {
  await shell(`uiautomator dump ${UI_DUMP}`);
  const xml = await shell(`cat ${UI_DUMP}`);
  const nodes: IUiNode[] = [];

  for (const match of xml.matchAll(/<node ([^>]*)>/g)) {
    const attributes = new Map([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attributes.get('bounds') ?? '');

    if (bounds === null) {
      continue;
    }

    const [left, top, right, bottom] = bounds.slice(1).map(Number);

    const text = attributes.get('text') ?? '';

    nodes.push({
      text: decodeXml(text === '' ? (attributes.get('content-desc') ?? '') : text),
      resourceId: attributes.get('resource-id') ?? '',
      className: attributes.get('class') ?? '',
      centre: { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) },
    });
  }

  return nodes;
}

function decodeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#10;', '\n')
    .replaceAll('&amp;', '&');
}

export async function findNode(
  matches: (node: IUiNode) => boolean,
  what: string,
  timeoutMs = 10_000
): Promise<IUiNode> {
  try {
    return await waitFor(what, async () => (await dumpUi()).find(matches), timeoutMs);
  } catch (error) {
    throw new Error(`${String(error)}; on screen: ${await describeScreen()}`);
  }
}

async function describeScreen(): Promise<string> {
  const texts = (await dumpUi().catch(() => [])).map(node => node.text).filter(text => text !== '');

  return JSON.stringify(texts.slice(0, 30));
}

/** Waits a moment after the tap, which a focused field needs before it takes typing. */
export async function tap(node: IUiNode): Promise<void> {
  await shell(`input tap ${node.centre.x} ${node.centre.y}`);
  await sleep(1000);
}

export async function tapText(text: string, timeoutMs?: number): Promise<void> {
  await tap(await findNode(node => node.text === text, `"${text}" on screen`, timeoutMs));
}

/** Types into the focused field; `input text` takes `%s` for a space and no shell metacharacters. */
export async function typeText(text: string): Promise<void> {
  if (!/^[\w@.+ -]*$/.test(text)) {
    throw new Error(`typeText cannot type ${JSON.stringify(text)}`);
  }

  await shell(`input text '${text.replaceAll(' ', '%s')}'`);
}

export async function pressEnter(): Promise<void> {
  await shell('input keyevent ENTER');
}

export async function screenshot(name: string): Promise<string> {
  const dir = join(ARTIFACTS_DIR, 'android-screenshots');
  mkdirSync(dir, { recursive: true });

  const remote = `/data/local/tmp/${name}.png`;
  const target = join(dir, `${name}.png`);

  await shell(`screencap -p ${remote}`);
  await adb('pull', remote, target);

  return target;
}

export async function clearLogcat(): Promise<void> {
  await adb('logcat', '-c');
}

export async function readLogcat(): Promise<string> {
  return adb('logcat', '-d');
}

/** fxa-client logs each state machine step (application-services fxa-client/src/state_machine). */
export async function fxaStates(): Promise<string[]> {
  const log = await readLogcat();

  return [...log.matchAll(/FxaStateMachine\.process_event finished \(Done\((\w+)\)\)/g)].map(match => match[1]);
}

/** Copies Firefox's Places database out of the app sandbox; the WAL comes too, so recent writes are included. */
export async function pullPlaces(): Promise<string> {
  const dir = join(ARTIFACTS_DIR, 'android-places');
  mkdirSync(dir, { recursive: true });

  for (const suffix of ['', '-wal', '-shm']) {
    const remote = `${APP_DATA}/files/places.sqlite${suffix}`;

    if ((await shell(`[ -e ${remote} ] && echo yes || true`)).trim() === 'yes') {
      await shell(
        `cp ${remote} /data/local/tmp/places.sqlite${suffix} && chmod 644 /data/local/tmp/places.sqlite${suffix}`
      );
      await adb('pull', `/data/local/tmp/places.sqlite${suffix}`, join(dir, `places.sqlite${suffix}`));
    }
  }

  return join(dir, 'places.sqlite');
}

/** Presses Sync now and waits for a sync that succeeds; `pressSyncNow` alone for one expected to fail. */
export async function syncNow(timeoutMs = 30_000): Promise<void> {
  const finishedRuns = async () => (await readLogcat()).split(SYNC_FINISHED).length - 1;
  const before = await finishedRuns();

  await pressSyncNow();

  await waitFor('Sync now to finish', async () => (await finishedRuns()) > before, timeoutMs, 2000);
}

export async function pressSyncNow(): Promise<void> {
  // Firefox drops a deep link that arrives while it is still opening a page, so ask until settings shows.
  const account = await waitFor(
    'the account in settings',
    async () => {
      await openDeepLink('settings');
      await sleep(2000);

      return (await dumpUi()).find(node => node.resourceId.endsWith('email'));
    },
    20_000,
    0
  ).catch(async (error: unknown) => {
    throw new Error(`${String(error)}; on screen: ${await describeScreen()}`);
  });

  await tap(account);
  await tapText('Sync now');
}

export async function waitForFxaState(state: string, timeoutMs = 45_000): Promise<void> {
  await waitFor(`Firefox's account state ${state}`, async () => (await fxaStates()).at(-1) === state, timeoutMs, 3000);
}

export async function signInToSync(email: string, password: string): Promise<void> {
  await openDeepLink('turn_on_sync');
  await tapText('Use email instead', 20_000);

  // The form shows only once Firefox has answered, after the reload the first sign-in page of a run needs.
  await findNode(isTextField, 'the email field', 20_000);

  await typeIntoField(email);
  await pressEnter();

  await findNode(node => node.text === 'Enter your password', 'the password step');
  await tap(await findNode(isTextField, 'the password field'));
  await typeText(password);
  await pressEnter();
}

const isTextField = (node: IUiNode) => node.className === 'android.widget.EditText';

/** Types into the page's only text field until it holds `text`; keys sent while the page re-renders can land out of order. */
async function typeIntoField(text: string): Promise<void> {
  await waitFor(
    `the text field to hold ${text}`,
    async () => {
      await tap(await findNode(isTextField, 'the text field'));
      await shell('input keycombination KEYCODE_CTRL_LEFT KEYCODE_A && input keyevent KEYCODE_DEL');
      await typeText(text);

      return (await dumpUi()).find(isTextField)?.text === text;
    },
    30_000,
    0
  );
}

/** Reads a copy of Firefox's Places database, taken now. */
export async function readPlaces<T>(query: (database: DatabaseSync) => T): Promise<T> {
  const database = new DatabaseSync(await pullPlaces(), { readOnly: true });

  try {
    return query(database);
  } finally {
    database.close();
  }
}

export async function hasBookmark(url: string): Promise<boolean> {
  return readPlaces(
    database =>
      database
        .prepare('SELECT 1 FROM moz_bookmarks AS b JOIN moz_places AS p ON b.fk = p.id WHERE p.url = ?')
        .get(url) !== undefined
  );
}
