import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { deriveTokenKeys } from '@libs/fxa-crypto';

import {
  findNode,
  hasBookmark,
  type IEmulator,
  installFirefox,
  openUrl,
  pressSyncNow,
  readLogcat,
  screenshot,
  signInToSync,
  startEmulator,
  syncNow,
  waitFor,
  waitForFxaState,
} from '../android.ts';
import {
  addBookmark,
  getHistory,
  type IFirefox,
  launchFirefox,
  triggerSync,
  waitForSignedIn,
  waitForSyncKeys,
} from '../firefox.ts';
import { ARTIFACTS_DIR } from '../paths.ts';
import { authClient, createInvite, SERVER_URL, uniqueEmail } from '../server.ts';
import { signInToSync as signInDesktopToSync } from '../ui.ts';

const PASSWORD = 'correct horse battery staple';

/** The ids of the account's sessions that carry a mobile device, from the Devices page's own endpoint. */
async function mobileSessionIds(apiToken: string): Promise<number[]> {
  const response = await fetch(`${SERVER_URL}/api/v1/user/session/list`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  assert.ok(response.ok, `the session list answered ${response.status}`);

  const body: unknown = await response.json();
  assert.ok(typeof body === 'object' && body !== null && 'sessionList' in body && Array.isArray(body.sessionList));

  const sessionList: unknown[] = body.sessionList;

  return sessionList.filter(isMobileSession).map(entry => entry.id);
}

function isMobileSession(entry: unknown): entry is { id: number } {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'id' in entry &&
    typeof entry.id === 'number' &&
    'device' in entry &&
    typeof entry.device === 'object' &&
    entry.device !== null &&
    'type' in entry.device &&
    entry.device.type === 'mobile'
  );
}

void describe(`Firefox for Android signs in and syncs against ${SERVER_URL}`, () => {
  const email = uniqueEmail('android');
  const bookmark = { url: `https://example.com/android-bookmark-${Date.now()}`, title: 'From desktop' };
  const visitUrl = `${SERVER_URL}/android-visit-${Date.now()}`;

  let emulator: IEmulator | undefined;
  let desktop: IFirefox | undefined;
  let apiToken: string;

  before(async () => {
    const link = await createInvite(email);
    await authClient.signUp({ email, password: PASSWORD, inviteToken: link.split('/').pop() ?? '' });

    const session = await authClient.signIn(email, PASSWORD);
    apiToken = `fxs_${(await deriveTokenKeys(session.sessionToken, 'sessionToken')).tokenId}`;

    emulator = await startEmulator({ headless: process.env.ANDROID_WINDOW === undefined });
    await installFirefox(SERVER_URL);
  });

  after(async () => {
    await screenshot('android-end').catch(() => undefined);
    writeFileSync(
      join(ARTIFACTS_DIR, 'android-logcat.txt'),
      await readLogcat().catch((error: unknown) => String(error))
    );
    await desktop?.quit().catch(() => undefined);
    await emulator?.stop();
  });

  void it('signs desktop Firefox in and syncs a bookmark', async () => {
    desktop = await launchFirefox({ serverUrl: SERVER_URL, name: 'desktop' });
    await signInDesktopToSync(desktop.driver, email, PASSWORD);
    await waitForSignedIn(desktop.driver);
    await waitForSyncKeys(desktop.driver);

    await addBookmark(desktop.driver, bookmark);
    const result = await triggerSync(desktop.driver);
    assert.equal(result.status.sync, 'success.sync');
  });

  void it('signs Firefox for Android in through the sign-in page and registers its device', async () => {
    await signInToSync(email, PASSWORD);
    await waitForFxaState('Connected');

    assert.equal((await mobileSessionIds(apiToken)).length, 1, 'the Devices page lists the Android device');
  });

  void it('brings the desktop bookmark to Android', async () => {
    await syncNow();

    assert.ok(await hasBookmark(bookmark.url), 'Android has the bookmark');
  });

  void it('carries an Android history visit to desktop', async () => {
    await openUrl(visitUrl);
    await findNode(node => node.text === 'Page not found', 'the visited page');
    await syncNow();

    assert.ok(desktop, 'desktop Firefox is running');
    const desktopDriver = desktop.driver;

    const history = await waitFor(
      'the Android visit on desktop',
      async () => {
        await triggerSync(desktopDriver);

        return getHistory(desktopDriver, visitUrl);
      },
      45_000,
      5000
    );

    assert.equal(history.url, visitUrl);
  });

  void it('stops Android syncing once the Devices page signs it out', async () => {
    const [androidSessionId] = await mobileSessionIds(apiToken);
    assert.notEqual(androidSessionId, undefined);

    const response = await fetch(`${SERVER_URL}/api/v1/user/session/${androidSessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    assert.ok(response.ok, `signing out answered ${response.status}`);

    await pressSyncNow();
    await waitForFxaState('AuthIssues');
  });
});
