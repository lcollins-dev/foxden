import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';

import { ARTIFACTS_DIR, FETCHED_FIREFOX_BINARY, FIREFOX_VERSION, GECKODRIVER_PATH } from './paths.ts';

export type TPrefValue = string | number | boolean;

export interface ILaunchOptions {
  serverUrl: string;
  headless?: boolean;
  firefoxBinary?: string;
  // Receives every request not bound for serverUrl or localhost. The default 127.0.0.1:9 refuses them; null disables.
  sinkProxy?: string | null;
  prefs?: Record<string, TPrefValue>;
  name?: string;
}

export interface IFirefox {
  driver: Driver;
  logFile: string;
  // Deleted on quit().
  profileDir: string;
  browserVersion: string;
  quit(): Promise<void>;
}

export interface ISignedInUser {
  email: string;
  uid: string;
  verified: boolean;
  displayName: string | null;
}

export interface IUIState {
  status: string;
  syncEnabled: boolean;
  email: string | null;
  lastSync: string | null;
}

export interface ISyncStatus {
  login: string;
  service: string;
  sync: string;
  engines: Record<string, string>;
  lastSync: string | null;
  loggedIn: boolean;
  locked: boolean;
}

export interface ISyncNotification {
  topic: string;
  data: string | null;
  subject: string | null;
}

export interface ISyncResult {
  status: ISyncStatus;
  notifications: ISyncNotification[];
  thrown: string | null;
}

export interface IBookmark {
  guid: string;
  url: string;
  title: string;
  parentGuid: string;
}

export interface IHistoryEntry {
  guid: string;
  url: string;
  title: string;
  visitCount: number;
}

export type TBookmarkFolder = 'toolbar' | 'menu' | 'unfiled' | 'mobile';

const SYSTEM_FIREFOX_BINARY = '/usr/bin/firefox';

const DEFAULT_SINK_PROXY = '127.0.0.1:9';

const SCRIPT_TIMEOUT_MS = 120_000;

// Complements the prefs Marionette sets itself (remote/shared/RecommendedPreferences.sys.mjs).
export function harnessPrefs(serverUrl: string): Record<string, TPrefValue> {
  return {
    'identity.fxaccounts.autoconfig.uri': serverUrl,
    'identity.fxaccounts.allowHttp': true,
    'identity.fxaccounts.loglevel': 'Debug',
    'identity.fxaccounts.telemetry.clientAssociationPing.enabled': false,
    'identity.fxaccounts.telemetry.clientInfoPing.enabled': false,

    'services.sync.log.appender.dump': 'Debug',
    'services.sync.log.appender.file.logOnSuccess': true,
    'services.sync.log.appender.file.level': 'Debug',

    'browser.aboutwelcome.enabled': false,
    'trailhead.firstrun.didSeeAboutWelcome': true,
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.newtabpage.enabled': false,
    'browser.newtab.preload': false,
    'browser.newtabpage.activity-stream.feeds.section.topstories': false,
    'browser.newtabpage.activity-stream.feeds.topsites': false,
    'browser.newtabpage.activity-stream.feeds.telemetry': false,
    'browser.newtabpage.activity-stream.telemetry': false,
    'browser.uitour.enabled': false,

    'toolkit.telemetry.enabled': false,
    'toolkit.telemetry.unified': false,
    'toolkit.telemetry.archive.enabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'datareporting.healthreport.uploadEnabled': false,
    'datareporting.policy.dataSubmissionEnabled': false,
    'datareporting.usage.uploadEnabled': false,
    'app.shield.optoutstudies.enabled': false,
    'app.normandy.enabled': false,
    'messaging-system.rsexperimentloader.enabled': false,

    'app.update.auto': false,
    'browser.region.update.enabled': false,
    'browser.safebrowsing.provider.google4.updateURL': '',
    'browser.safebrowsing.provider.mozilla.updateURL': '',
    'media.gmp-manager.updateEnabled': false,
    'network.trr.mode': 5,
    'network.dns.disablePrefetch': true,
    'network.prefetch-next': false,
    'network.predictor.enabled': false,
    'network.http.speculative-parallel-limit': 0,
    'browser.places.speculativeConnect.enabled': false,
  };
}

export function sinkProxyPrefs(sinkProxy: string, serverUrl: string): Record<string, TPrefValue> {
  const [host, port] = sinkProxy.split(':');

  return {
    'network.proxy.type': 1,
    'network.proxy.http': host,
    'network.proxy.http_port': Number(port),
    'network.proxy.ssl': host,
    'network.proxy.ssl_port': Number(port),
    'network.proxy.share_proxy_settings': true,
    'network.proxy.no_proxies_on': new URL(serverUrl).hostname,
  };
}

// Release builds ignore `services.settings.server` unless MOZ_REMOTE_SETTINGS_DEVTOOLS is set
// (services/settings/Utils.sys.mjs), so without it Remote Settings keeps polling Mozilla.
function firefoxEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  environment.MOZ_REMOTE_SETTINGS_DEVTOOLS = '1';
  return environment;
}

function firefoxBinary(options: ILaunchOptions): string {
  const chosen = options.firefoxBinary ?? process.env.FIREFOX_BINARY;

  if (chosen !== undefined) {
    return chosen;
  }

  if (existsSync(FETCHED_FIREFOX_BINARY)) {
    return FETCHED_FIREFOX_BINARY;
  }

  if (existsSync(SYSTEM_FIREFOX_BINARY)) {
    console.warn(
      `Using ${SYSTEM_FIREFOX_BINARY}, not the pinned Firefox ${FIREFOX_VERSION}: run \`npm run fetch-firefox\``
    );
    return SYSTEM_FIREFOX_BINARY;
  }

  throw new Error(
    `Firefox missing at ${FETCHED_FIREFOX_BINARY} and ${SYSTEM_FIREFOX_BINARY}: run \`npm run fetch-firefox -w firefox-e2e\` or set FIREFOX_BINARY`
  );
}

export async function launchFirefox(options: ILaunchOptions): Promise<IFirefox> {
  if (!existsSync(GECKODRIVER_PATH)) {
    throw new Error(`geckodriver missing at ${GECKODRIVER_PATH}: run \`npm run fetch-geckodriver\``);
  }

  const serverUrl = options.serverUrl.replace(/\/+$/, '');
  const sinkProxy = options.sinkProxy === undefined ? DEFAULT_SINK_PROXY : options.sinkProxy;

  const prefs = {
    ...harnessPrefs(serverUrl),
    ...(sinkProxy === null ? {} : sinkProxyPrefs(sinkProxy, serverUrl)),
    ...options.prefs,
  };

  const firefoxOptions = new Options().setBinary(firefoxBinary(options));

  if (options.headless ?? true) {
    firefoxOptions.addArguments('-headless');
  }

  for (const [name, value] of Object.entries(prefs)) {
    firefoxOptions.setPreference(name, value);
  }

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const logFile = join(ARTIFACTS_DIR, `firefox-${options.name ?? 'profile'}-${Date.now()}.log`);
  const logFd = openSync(logFile, 'a');

  const service = new ServiceBuilder(GECKODRIVER_PATH)
    .addArguments('--allow-system-access')
    .setEnvironment(firefoxEnvironment())
    .setStdio(['ignore', logFd, logFd])
    .build();

  const driver = Driver.createSession(firefoxOptions, service);

  try {
    await driver.manage().setTimeouts({ script: SCRIPT_TIMEOUT_MS });

    const capabilities = await driver.getCapabilities();
    const profileDir = await inChrome(driver, () => Services.dirsvc.get('ProfD', Ci.nsIFile).path);

    return {
      driver,
      logFile,
      profileDir,
      browserVersion: String(capabilities.get('browserVersion')),
      quit: async () => {
        try {
          await driver.quit();
        } finally {
          closeSync(logFd);
        }
      },
    };
  } catch (error) {
    await driver.quit().catch(() => undefined);
    closeSync(logFd);
    throw new Error(`Firefox failed to start, see ${logFile}`, { cause: error });
  }
}

// fn is serialised with toString() and runs with the browser window as its global: it must not close over
// anything, and its arguments and result must be JSON.
export async function inChrome<TArgs extends unknown[], TResult>(
  driver: Driver,
  fn: (...args: TArgs) => TResult | Promise<TResult>,
  ...args: TArgs
): Promise<TResult> {
  const previous = await driver.getContext();
  await driver.setContext(Context.CHROME);

  try {
    return await driver.executeScript<TResult>(`return (${fn.toString()}).apply(null, arguments);`, ...args);
  } finally {
    if (previous !== Context.CHROME) {
      await driver.setContext(previous);
    }
  }
}

export function getPref(driver: Driver, name: string): Promise<TPrefValue | null> {
  return inChrome(
    driver,
    (prefName: string) => {
      switch (Services.prefs.getPrefType(prefName)) {
        case Services.prefs.PREF_STRING:
          return Services.prefs.getStringPref(prefName);
        case Services.prefs.PREF_INT:
          return Services.prefs.getIntPref(prefName);
        case Services.prefs.PREF_BOOL:
          return Services.prefs.getBoolPref(prefName);
        default:
          return null;
      }
    },
    name
  );
}

// Each call starts a fresh OAuth flow in Firefox, with its own state, PKCE verifier and keys_jwk key pair.
export function getConnectAccountUrl(driver: Driver, entrypoint = 'fxa_avatar_menu'): Promise<string> {
  return inChrome(
    driver,
    (entry: string) => {
      const { FxAccounts } = ChromeUtils.importESModule('resource://gre/modules/FxAccounts.sys.mjs');
      return FxAccounts.config.promiseConnectAccountURI('sync', entry);
    },
    entrypoint
  );
}

// Takes the same path as the avatar menu's "Sign in" button, and switches WebDriver to the tab it opens.
export async function openSyncSignIn(
  driver: Driver,
  { entrypoint = 'fxa_avatar_menu', timeoutMs = 30_000 } = {}
): Promise<string> {
  const handlesBefore = new Set(await driver.getAllWindowHandles());

  const url = await inChrome(
    driver,
    async (entry: string, timeout: number) => {
      await gSync.openFxAEmailFirstPage(entry);

      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const spec = gBrowser.selectedBrowser.currentURI.spec;
        if (!spec.startsWith('about:')) {
          return spec;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      throw new Error(`No sign-in page loaded within ${timeout} ms`);
    },
    entrypoint,
    timeoutMs
  );

  const newHandle = (await driver.getAllWindowHandles()).find(handle => !handlesBefore.has(handle));
  if (newHandle !== undefined) {
    await driver.switchTo().window(newHandle);
  }

  return url;
}

export function getSignedInUser(driver: Driver): Promise<ISignedInUser | null> {
  return inChrome(driver, async () => {
    const { getFxAccountsSingleton } = ChromeUtils.importESModule('resource://gre/modules/FxAccounts.sys.mjs');
    const user = await getFxAccountsSingleton().getSignedInUser();

    if (!user) {
      return null;
    }

    return { email: user.email, uid: user.uid, verified: user.verified, displayName: user.displayName ?? null };
  });
}

export function getUIState(driver: Driver): Promise<IUIState> {
  return inChrome(driver, () => {
    const { UIState } = ChromeUtils.importESModule('resource://services-sync/UIState.sys.mjs');
    const state = UIState.get();

    return {
      status: state.status,
      syncEnabled: Boolean(state.syncEnabled),
      email: state.email ?? null,
      lastSync: state.lastSync ? state.lastSync.toISOString() : null,
    };
  });
}

export async function waitForSignedIn(
  driver: Driver,
  { timeoutMs = 60_000, verified = true } = {}
): Promise<ISignedInUser> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const user = await getSignedInUser(driver);
    if (user !== null && (!verified || user.verified)) {
      return user;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Firefox did not sign in within ${timeoutMs} ms`);
}

export function getSyncStatus(driver: Driver): Promise<ISyncStatus> {
  return inChrome(driver, () => {
    const { Weave } = ChromeUtils.importESModule('resource://services-sync/main.sys.mjs');
    const lastSync = Services.prefs.getStringPref('services.sync.lastSync', '');

    return {
      login: Weave.Status.login,
      service: Weave.Status.service,
      sync: Weave.Status.sync,
      engines: { ...Weave.Status.engines },
      lastSync: lastSync === '' ? null : lastSync,
      loggedIn: Weave.Service.isLoggedIn,
      locked: Weave.Service.locked,
    };
  });
}

// Waits out a sync already in flight first: Weave.Service.sync() silently does nothing while another holds the lock.
export function triggerSync(driver: Driver, { engines }: { engines?: string[] } = {}): Promise<ISyncResult> {
  return inChrome(
    driver,
    async (engineNames: string[] | null) => {
      const { Weave } = ChromeUtils.importESModule('resource://services-sync/main.sys.mjs');
      const topics = [
        'weave:service:login:error',
        'weave:service:sync:error',
        'weave:service:sync:finish',
        'weave:engine:sync:error',
      ];
      const notifications: { topic: string; data: string | null; subject: string | null }[] = [];
      const observer = {
        observe(subject: unknown, topic: string, data: string | null) {
          const wrapper =
            typeof subject === 'object' && subject !== null && 'wrappedJSObject' in subject
              ? subject.wrappedJSObject
              : undefined;

          // Sync's observers module wraps the subject it notifies with.
          let inner = wrapper;
          if (
            typeof wrapper === 'object' &&
            wrapper !== null &&
            'observersModuleSubjectWrapper' in wrapper &&
            wrapper.observersModuleSubjectWrapper
          ) {
            inner = 'object' in wrapper ? wrapper.object : undefined;
          }

          let description: string | null = null;
          if (inner) {
            const message = typeof inner === 'object' && 'message' in inner ? inner.message : undefined;
            const shown: unknown = message ?? JSON.stringify(inner);
            description = String(shown);
          }

          notifications.push({ topic, data: data === '' ? null : data, subject: description });
        },
      };

      while (Weave.Service.locked) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      for (const topic of topics) {
        Services.obs.addObserver(observer, topic);
      }

      let thrown: string | null = null;
      try {
        await Weave.Service.sync({ why: 'user', engines: engineNames ?? undefined });
      } catch (error) {
        thrown = String(error);
      } finally {
        for (const topic of topics) {
          Services.obs.removeObserver(observer, topic);
        }
      }

      const lastSync = Services.prefs.getStringPref('services.sync.lastSync', '');

      return {
        status: {
          login: Weave.Status.login,
          service: Weave.Status.service,
          sync: Weave.Status.sync,
          engines: { ...Weave.Status.engines },
          lastSync: lastSync === '' ? null : lastSync,
          loggedIn: Weave.Service.isLoggedIn,
          locked: Weave.Service.locked,
        },
        notifications,
        thrown,
      };
    },
    engines ?? null
  );
}

export function readSyncLogs(firefox: IFirefox): { file: string; content: string }[] {
  const dir = join(firefox.profileDir, 'weave', 'logs');
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .sort()
    .map(file => ({ file, content: readFileSync(join(dir, file), 'utf8') }));
}

export function addBookmark(
  driver: Driver,
  { url, title, folder = 'unfiled' }: { url: string; title: string; folder?: TBookmarkFolder }
): Promise<IBookmark> {
  return inChrome(
    driver,
    async (bookmarkUrl: string, bookmarkTitle: string, folderName: TBookmarkFolder) => {
      const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
      const folderGuids = {
        toolbar: PlacesUtils.bookmarks.toolbarGuid,
        menu: PlacesUtils.bookmarks.menuGuid,
        unfiled: PlacesUtils.bookmarks.unfiledGuid,
        mobile: PlacesUtils.bookmarks.mobileGuid,
      };
      const bookmark = await PlacesUtils.bookmarks.insert({
        parentGuid: folderGuids[folderName],
        url: bookmarkUrl,
        title: bookmarkTitle,
      });

      return { guid: bookmark.guid, url: bookmark.url.href, title: bookmark.title, parentGuid: bookmark.parentGuid };
    },
    url,
    title,
    folder
  );
}

export function getBookmarks(driver: Driver, url: string): Promise<IBookmark[]> {
  return inChrome(
    driver,
    async (bookmarkUrl: string) => {
      const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
      const found: { guid: string; url: string; title: string; parentGuid: string }[] = [];

      await PlacesUtils.bookmarks.fetch({ url: bookmarkUrl }, (bookmark: IBookmarkItem) => {
        found.push({
          guid: bookmark.guid,
          url: bookmark.url.href,
          title: bookmark.title,
          parentGuid: bookmark.parentGuid,
        });
      });

      return found;
    },
    url
  );
}

export function addHistoryVisit(
  driver: Driver,
  { url, title }: { url: string; title: string }
): Promise<IHistoryEntry> {
  return inChrome(
    driver,
    async (pageUrl: string, pageTitle: string) => {
      const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
      const page = await PlacesUtils.history.insert({
        url: pageUrl,
        title: pageTitle,
        visits: [{ transition: PlacesUtils.history.TRANSITIONS.TYPED, date: new Date() }],
      });

      return { guid: page.guid, url: page.url.href, title: page.title, visitCount: page.visits.length };
    },
    url,
    title
  );
}

export function getHistory(driver: Driver, url: string): Promise<IHistoryEntry | null> {
  return inChrome(
    driver,
    async (pageUrl: string) => {
      const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
      const page = await PlacesUtils.history.fetch(pageUrl, { includeVisits: true });

      if (!page) {
        return null;
      }

      return { guid: page.guid, url: page.url.href, title: page.title, visitCount: page.visits.length };
    },
    url
  );
}

export function hasSyncKeys(driver: Driver): Promise<boolean> {
  return inChrome(driver, () => {
    const { getFxAccountsSingleton } = ChromeUtils.importESModule('resource://gre/modules/FxAccounts.sys.mjs');
    return getFxAccountsSingleton().keys.hasKeysForScope('https://identity.mozilla.com/apps/oldsync');
  });
}

export async function waitForSyncKeys(driver: Driver, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await hasSyncKeys(driver)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Firefox did not store Sync keys within ${timeoutMs} ms`);
}
