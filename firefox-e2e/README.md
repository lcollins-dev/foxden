# Real Firefox tests

These tests drive release builds of Firefox against Foxden. The desktop suite uses geckodriver; the Android suite
uses an emulator.

## Setup

Run `npm install` at the repository root. This also downloads geckodriver into `.bin/`.

Run `npm run fetch-firefox -w firefox-e2e` once to download the pinned Linux x64 build. Without it, the suite uses
`/usr/bin/firefox`. Set `FIREFOX_BINARY` to use another build.

## Commands

Run these commands from `firefox-e2e` unless noted otherwise.

- `npm test` - sign in and sync with desktop Firefox. `npm run test:firefox` runs the same suite from the root.
- `npm run probe` - show the sign-in URL, requests and WebChannel response produced by Firefox.
- `npm run stub` - run the recording stub server on port 8787, or `PORT`.
- `npm run fetch-firefox` - download the pinned desktop build. Linux x64 only.
- `npm run fetch-android` - download the Android tools and Firefox build, about 4 GB. Linux x64, `/dev/kvm` and
  `unzip` are required.
- `npm run test:android` - sync Firefox for Android with a desktop profile. Set `ANDROID_WINDOW=1` to show the
  emulator.
- `npm run code:typecheck` - type-check this workspace. `code:lint` and `code:format:check` use the root configs.

Tests use the current checkout's dev instance. Set `SYNC_SERVER_URL` to use another server. Set `ANDROID_TOOLS_DIR`
to move the Android downloads.

Logs are written to `.artifacts/`.

## Test helpers

`src/firefox.ts`:

- `launchFirefox` starts Firefox with a temporary profile pointed at Foxden and blocks unrelated network requests.
- `inChrome(driver, fn, ...args)` runs `fn` in the browser window's privileged scope. `fn` must be self-contained.
- `openSyncSignIn` opens Firefox's Sync sign-in page.
- `getSignedInUser`, `waitForSignedIn` and `getUIState` read account state.
- `triggerSync`, `getSyncStatus` and `readSyncLogs` run and inspect a sync.
- Bookmark and history helpers support round-trip tests between profiles.

`src/stub-server.ts` records requests without recording authorization credentials.

`src/android.ts` contains the emulator, sign-in, sync and UI helpers for Firefox for Android.
