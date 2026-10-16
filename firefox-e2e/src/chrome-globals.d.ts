// Globals of Firefox's browser window (browser.xhtml), visible only inside functions passed to inChrome().
// Each interface declares only the members the harness uses.

interface INsIFile {
  readonly path: string;
}

interface IPrefBranch {
  readonly PREF_STRING: number;
  readonly PREF_INT: number;
  readonly PREF_BOOL: number;
  getPrefType(name: string): number;
  getStringPref(name: string, defaultValue?: string): string;
  getIntPref(name: string): number;
  getBoolPref(name: string): boolean;
}

interface IObserver {
  observe(subject: unknown, topic: string, data: string | null): void;
}

interface IServices {
  readonly prefs: IPrefBranch;
  readonly dirsvc: { get(key: string, iface: object): INsIFile };
  readonly obs: {
    addObserver(observer: IObserver, topic: string): void;
    removeObserver(observer: IObserver, topic: string): void;
  };
}

interface IFxaUserData {
  email: string;
  uid: string;
  verified: boolean;
  displayName?: string;
}

interface IFxAccounts {
  getSignedInUser(): Promise<IFxaUserData | null>;
  readonly keys: { hasKeysForScope(scope: string): Promise<boolean> };
}

interface IFxAccountsModule {
  FxAccounts: { config: { promiseConnectAccountURI(service: string, entrypoint: string): Promise<string> } };
  getFxAccountsSingleton: () => IFxAccounts;
}

interface IUIStateValue {
  status: string;
  syncEnabled?: boolean;
  email?: string;
  lastSync?: Date;
}

interface IUIStateModule {
  UIState: { get(): IUIStateValue };
}

interface IWeaveModule {
  Weave: {
    Status: { login: string; service: string; sync: string; engines: Record<string, string> };
    Service: {
      readonly isLoggedIn: boolean;
      readonly locked: boolean;
      sync(options: { why: string; engines?: string[] }): Promise<void>;
    };
  };
}

interface IBookmarkItem {
  guid: string;
  url: URL;
  title: string;
  parentGuid: string;
}

interface IPageInfo {
  guid: string;
  url: URL;
  title: string;
  visits: { date: Date; transition: number }[];
}

interface IPlacesUtilsModule {
  PlacesUtils: {
    bookmarks: {
      readonly toolbarGuid: string;
      readonly menuGuid: string;
      readonly unfiledGuid: string;
      readonly mobileGuid: string;
      insert(info: { parentGuid: string; url: string; title: string }): Promise<IBookmarkItem>;
      fetch(info: { url: string }, onResult: (bookmark: IBookmarkItem) => void): Promise<IBookmarkItem | null>;
    };
    history: {
      readonly TRANSITIONS: { readonly TYPED: number };
      insert(info: { url: string; title: string; visits: { transition: number; date: Date }[] }): Promise<IPageInfo>;
      fetch(url: string, options: { includeVisits: boolean }): Promise<IPageInfo | null>;
    };
  };
}

interface IChromeModules {
  'resource://gre/modules/FxAccounts.sys.mjs': IFxAccountsModule;
  'resource://services-sync/UIState.sys.mjs': IUIStateModule;
  'resource://services-sync/main.sys.mjs': IWeaveModule;
  'resource://gre/modules/PlacesUtils.sys.mjs': IPlacesUtilsModule;
}

declare const ChromeUtils: { importESModule<TUrl extends keyof IChromeModules>(url: TUrl): IChromeModules[TUrl] };
declare const Services: IServices;
declare const Ci: { readonly nsIFile: object };
declare const gSync: { openFxAEmailFirstPage(entrypoint: string): Promise<void> };
declare const gBrowser: { readonly selectedBrowser: { readonly currentURI: { readonly spec: string } } };
