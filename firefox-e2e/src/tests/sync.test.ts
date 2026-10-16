import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';

import {
  addBookmark,
  addHistoryVisit,
  getBookmarks,
  getHistory,
  getUIState,
  type IFirefox,
  type ISyncResult,
  launchFirefox,
  readSyncLogs,
  triggerSync,
  waitForSignedIn,
  waitForSyncKeys,
} from '../firefox.ts';
import { createInvite, resetPassword, SERVER_URL, uniqueEmail } from '../server.ts';
import { acceptInvite, signInToSync } from '../ui.ts';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a password chosen after a reset';

const ERROR_TOPICS = ['weave:service:login:error', 'weave:service:sync:error', 'weave:engine:sync:error'];

// Firefox writes a sync's log file after the sync resolves, so wait for the one this sync adds.
async function waitForNewSyncLog(firefox: IFirefox, known: Set<string>): Promise<{ file: string; content: string }> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const added = readSyncLogs(firefox).filter(log => !known.has(log.file));

    if (added.length > 0) {
      return added[added.length - 1];
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error('Firefox wrote no sync log');
}

/** Where a profile's logs stood, so a check can pass over errors Firefox logged before it on purpose. */
interface ILogMark {
  logLines: number;
  errorLogs: Set<string>;
}

const START: ILogMark = { logLines: 0, errorLogs: new Set() };

function firefoxLogLines(firefox: IFirefox): string[] {
  return readFileSync(firefox.logFile, 'utf8').split('\n');
}

function markLogs(firefox: IFirefox): ILogMark {
  return {
    logLines: firefoxLogLines(firefox).length,
    errorLogs: new Set(readSyncLogs(firefox).map(entry => entry.file)),
  };
}

// The dump appender puts Firefox's FxA and Sync logging on its stdout, which launchFirefox keeps in logFile.
function accountAndSyncErrors(firefox: IFirefox, since: ILogMark): string[] {
  return firefoxLogLines(firefox)
    .slice(since.logLines)
    .filter(line => /\t(FirefoxAccounts|Sync\.[\w.]+)\tERROR\t/.test(line));
}

async function waitForUIStatus(firefox: IFirefox, status: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let current = '';

  while (Date.now() < deadline) {
    current = (await getUIState(firefox.driver)).status;

    if (current === status) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Firefox's account status stayed ${current}, not ${status}`);
}

async function syncAndCheck(firefox: IFirefox, since: ILogMark = START): Promise<{ result: ISyncResult; log: string }> {
  const known = new Set(readSyncLogs(firefox).map(log => log.file));
  const result = await triggerSync(firefox.driver);
  const log = await waitForNewSyncLog(firefox, known);

  const failure = `sync result ${JSON.stringify(result, null, 2)}\n${log.file}:\n${log.content.slice(-6000)}`;

  assert.equal(result.thrown, null, failure);
  assert.equal(result.status.login, 'success.login', failure);
  assert.equal(result.status.sync, 'success.sync', failure);
  assert.deepEqual(
    result.notifications.filter(notification => ERROR_TOPICS.includes(notification.topic)),
    [],
    failure
  );
  assert.match(log.file, /^success-sync-/, failure);
  assert.deepEqual(accountAndSyncErrors(firefox, since), [], 'Firefox logged no account or Sync errors');
  assert.deepEqual(
    readSyncLogs(firefox)
      .map(entry => entry.file)
      .filter(file => file.startsWith('error-') && !since.errorLogs.has(file)),
    [],
    'Firefox wrote no error log for any sync'
  );

  return { result, log: log.content };
}

void describe(`Firefox signs in and syncs against ${SERVER_URL}`, () => {
  const email = uniqueEmail('sync');
  const bookmark = { url: `https://example.com/bookmark-${Date.now()}`, title: 'Synced bookmark' };
  const visit = { url: `https://example.com/visit-${Date.now()}`, title: 'Synced visit' };

  const profiles: IFirefox[] = [];

  const launch = async (name: string): Promise<IFirefox> => {
    const firefox = await launchFirefox({ serverUrl: SERVER_URL, name });
    profiles.push(firefox);

    return firefox;
  };

  let profileA: IFirefox;

  after(async () => {
    for (const firefox of profiles) {
      await firefox.quit().catch(() => undefined);
    }
  });

  void it('creates the invited account through the invite page in Firefox', async () => {
    const link = await createInvite(email);
    profileA = await launch('a');

    await acceptInvite(profileA.driver, link, PASSWORD);
  });

  void it('signs profile A in to Sync through the sign-in page', async () => {
    await signInToSync(profileA.driver, email, PASSWORD);

    const user = await waitForSignedIn(profileA.driver);
    assert.equal(user.email, email);
    assert.equal(user.verified, true);

    await waitForSyncKeys(profileA.driver);
  });

  void it('syncs profile A through the tokenserver and storage', async () => {
    const { log } = await syncAndCheck(profileA);
    const firefoxLog = readFileSync(profileA.logFile, 'utf8');

    assert.ok(firefoxLog.includes(`GET ${SERVER_URL}/token/1.0/sync/1.5 200`), 'Firefox fetched a tokenserver token');
    assert.match(log, /GET success 200 \S+\/storage\/1\.5\/\d+\/info\/collections/, 'the sync reached storage');
  });

  void it('carries a bookmark and a history visit to profile B', async () => {
    await addBookmark(profileA.driver, bookmark);
    await addHistoryVisit(profileA.driver, visit);
    await syncAndCheck(profileA);

    const profileB = await launch('b');
    await signInToSync(profileB.driver, email, PASSWORD);
    await waitForSignedIn(profileB.driver);
    await waitForSyncKeys(profileB.driver);

    let bookmarks = await getBookmarks(profileB.driver, bookmark.url);
    let history = await getHistory(profileB.driver, visit.url);

    for (let attempt = 0; attempt < 3 && (bookmarks.length === 0 || history === null); attempt++) {
      await syncAndCheck(profileB);
      bookmarks = await getBookmarks(profileB.driver, bookmark.url);
      history = await getHistory(profileB.driver, visit.url);
    }

    assert.equal(bookmarks.length, 1, 'profile B has the bookmark');
    assert.equal(bookmarks[0].title, bookmark.title);
    assert.notEqual(history, null, 'profile B has the history visit');
    assert.equal(history?.title, visit.title);
  });

  void it('signs profile A out on a password reset, and syncs its data again once it signs back in', async () => {
    await resetPassword(email, NEW_PASSWORD);

    // The reset revoked A's tokens, so its next sync finds the account needs signing in again.
    await triggerSync(profileA.driver);
    await waitForUIStatus(profileA, 'login_failed');

    const mark = markLogs(profileA);

    await signInToSync(profileA.driver, email, NEW_PASSWORD);
    await waitForUIStatus(profileA, 'signed_in');
    await waitForSyncKeys(profileA.driver);
    await syncAndCheck(profileA, mark);

    assert.equal((await getBookmarks(profileA.driver, bookmark.url)).length, 1, 'profile A kept its bookmark');

    const profileC = await launch('c');
    await signInToSync(profileC.driver, email, NEW_PASSWORD);
    await waitForSignedIn(profileC.driver);
    await waitForSyncKeys(profileC.driver);

    let bookmarks = await getBookmarks(profileC.driver, bookmark.url);

    for (let attempt = 0; attempt < 3 && bookmarks.length === 0; attempt++) {
      await syncAndCheck(profileC);
      bookmarks = await getBookmarks(profileC.driver, bookmark.url);
    }

    assert.equal(bookmarks.length, 1, 'profile C has the bookmark profile A uploaded again under the new key');
  });
});
