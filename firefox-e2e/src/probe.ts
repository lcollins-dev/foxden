import { getPref, getUIState, inChrome, launchFirefox, openSyncSignIn } from './firefox.ts';
import { type IRecordedRequest, PROBE_PREFIX, startStubServer } from './stub-server.ts';

const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? 5_000);

const AUTOCONFIGURED_PREFS = [
  'identity.fxaccounts.remote.root',
  'identity.fxaccounts.auth.uri',
  'identity.fxaccounts.remote.oauth.uri',
  'identity.fxaccounts.remote.profile.uri',
  'identity.fxaccounts.remote.pairing.uri',
  'identity.sync.tokenserver.uri',
  'identity.fxaccounts.contextParam',
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(100);
  }

  return predicate();
}

function describeParam(key: string, value: string): string {
  if (key === 'keys_jwk') {
    return `${value.slice(0, 16)}... = ${Buffer.from(value, 'base64url').toString('utf8')}`;
  }

  return value;
}

function formatRequest(request: IRecordedRequest): string {
  if (request.proxiedTo !== undefined) {
    return `  ${request.method} ${request.proxiedTo}${request.path} (blocked by sink proxy)`;
  }

  const query = new URLSearchParams(
    Object.entries(request.query).flatMap(([key, values]) => values.map(value => [key, value]))
  ).toString();
  const referer = request.headers.referer === undefined ? '' : `  referer=${request.headers.referer}`;

  return `  ${request.method} ${request.path}${query === '' ? '' : `?${query}`}${referer}`;
}

async function main(): Promise<void> {
  const stub = await startStubServer();
  const stubHost = new URL(stub.origin).host;
  console.log(`Stub server: ${stub.origin}`);

  const firefox = await launchFirefox({ serverUrl: stub.origin, headless: true, sinkProxy: stubHost, name: 'probe' });

  try {
    console.log(`Firefox ${firefox.browserVersion}, profile ${firefox.profileDir}`);
    console.log(`Firefox log: ${firefox.logFile}`);

    await sleep(SETTLE_MS);
    const startupCount = stub.requests().length;

    const signInUrl = await openSyncSignIn(firefox.driver);
    await waitFor(() => stub.requests().some(request => request.path.startsWith(PROBE_PREFIX)), 15_000);
    await sleep(1_000);

    const url = new URL(signInUrl);
    console.log(`\n== URL Firefox opened for "Sign in" (entrypoint fxa_avatar_menu)\n${signInUrl}`);
    console.log(`\n== Query params (${url.origin}${url.pathname})`);
    for (const [key, value] of url.searchParams) {
      console.log(`  ${key} = ${describeParam(key, value)}`);
    }

    console.log('\n== Prefs after autoconfig');
    for (const pref of AUTOCONFIGURED_PREFS) {
      console.log(`  ${pref} = ${String(await getPref(firefox.driver, pref))}`);
    }

    console.log(`\n== UI state: ${JSON.stringify(await getUIState(firefox.driver))}`);
    console.log(
      `== FxA WebChannel origin: ${await inChrome(firefox.driver, () =>
        Services.prefs.getStringPref('identity.fxaccounts.remote.root')
      )}`
    );

    const requests = stub.requests();
    console.log(`\n== Requests during startup and ${SETTLE_MS} ms idle (${startupCount})`);
    requests.slice(0, startupCount).forEach(request => console.log(formatRequest(request)));
    console.log(`\n== Requests after "Sign in" (${requests.length - startupCount})`);
    requests.slice(startupCount).forEach(request => console.log(formatRequest(request)));

    for (const request of requests.filter(entry => entry.path.startsWith(PROBE_PREFIX))) {
      console.log(`\n== WebChannel fxa_status reply\n${JSON.stringify(request.body, null, 2)}`);
    }

    const config = requests.find(request => request.path === '/.well-known/fxa-client-configuration');
    if (config !== undefined) {
      console.log(`\n== Autoconfig request headers\n${JSON.stringify(config.headers, null, 2)}`);
    }

    console.log(`\nRecorded requests: ${stub.logFile}`);
  } finally {
    await firefox.quit();
    await stub.close();
  }
}

await main();
