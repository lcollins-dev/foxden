import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { ARTIFACTS_DIR } from './paths.ts';

export interface IRecordedRequest {
  time: string;
  method: string;
  path: string;
  query: Record<string, string[]>;
  headers: Partial<Record<string, string>>;
  bodyLength: number;
  body?: unknown;
  bodyKeys?: string[];
  // Set when Firefox used the stub as its sink proxy: the host it tried to reach.
  proxiedTo?: string;
}

export interface IStubServer {
  origin: string;
  logFile: string;
  server: Server;
  requests(): IRecordedRequest[];
  close(): Promise<void>;
}

export interface IStubServerOptions {
  port?: number;
  host?: string;
  logFile?: string;
}

// Paths under this prefix are the placeholder page reporting back what Firefox told it over WebChannel.
export const PROBE_PREFIX = '/__probe/';

const RECORDED_HEADERS = [
  'host',
  'user-agent',
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'origin',
  'referer',
  'x-keyid',
  'x-client-state',
  'x-if-modified-since',
  'x-if-unmodified-since',
  'x-weave-records',
  'x-weave-bytes',
  'x-weave-total-records',
  'x-weave-total-bytes',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
];

export function fxaClientConfiguration(origin: string): Record<string, string> {
  const host = new URL(origin).host;

  return {
    auth_server_base_url: `${origin}/auth`,
    oauth_server_base_url: `${origin}/oauth`,
    profile_server_base_url: `${origin}/profile`,
    sync_tokenserver_base_url: `${origin}/token`,
    pairing_server_base_uri: `ws://${host}/pairing`,
  };
}

// Records the scheme and shape of a credential, never its value.
function describeAuthorization(value: string): string {
  const [scheme, ...rest] = value.split(' ');
  const credential = rest.join(' ');

  if (scheme === 'Hawk') {
    const id = /id="([^"]*)"/.exec(credential)?.[1] ?? '';
    return `Hawk (id ${id.length} chars, redacted)`;
  }

  const prefix = /^(fx[a-z]_)/.exec(credential)?.[1] ?? '';
  return `${scheme} ${prefix}(${credential.length} chars, redacted)`;
}

function recordHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const name of RECORDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') {
      headers[name] = value;
    }
  }

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    headers.authorization = describeAuthorization(authorization);
  }

  return headers;
}

function queryOf(url: URL): Record<string, string[]> {
  const query: Record<string, string[]> = {};

  for (const [key, value] of url.searchParams) {
    query[key] = [...(query[key] ?? []), value];
  }

  return query;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks);
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

function placeholderPage(): string {
  return readFileSync(join(import.meta.dirname, 'placeholder.html'), 'utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function startStubServer(options: IStubServerOptions = {}): Promise<IStubServer> {
  const host = options.host ?? '127.0.0.1';
  const logFile = options.logFile ?? join(ARTIFACTS_DIR, `stub-requests-${Date.now()}.jsonl`);
  const recorded: IRecordedRequest[] = [];
  let origin = '';

  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, '');

  const record = (entry: IRecordedRequest): void => {
    recorded.push(entry);
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', origin);
    const body = await readBody(request);

    if (url.origin !== origin) {
      record({
        time: new Date().toISOString(),
        method: request.method ?? '',
        path: url.pathname,
        query: queryOf(url),
        headers: recordHeaders(request),
        bodyLength: body.length,
        proxiedTo: url.host,
      });
      response.writeHead(403).end();
      return;
    }

    const json = parseJson(body);

    const entry: IRecordedRequest = {
      time: new Date().toISOString(),
      method: request.method ?? '',
      path: url.pathname,
      query: queryOf(url),
      headers: recordHeaders(request),
      bodyLength: body.length,
    };

    if (url.pathname.startsWith(PROBE_PREFIX)) {
      entry.body = json;
    } else if (typeof json === 'object' && json !== null) {
      entry.bodyKeys = Object.keys(json);
    }

    record(entry);

    if (url.pathname === '/.well-known/fxa-client-configuration') {
      sendJson(response, 200, fxaClientConfiguration(origin));
      return;
    }

    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(placeholderPage());
      return;
    }

    sendJson(response, 404, { code: 404, errno: 999, error: 'Not Found', message: 'Stub server' });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error('Stub server error', error);
      response.statusCode = 500;
      response.end();
    });
  });

  server.on('connect', (request: IncomingMessage, socket: Duplex) => {
    record({
      time: new Date().toISOString(),
      method: 'CONNECT',
      path: '',
      query: {},
      headers: recordHeaders(request),
      bodyLength: 0,
      proxiedTo: request.url ?? '',
    });
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  await new Promise<void>(resolve => server.listen(options.port ?? 0, host, resolve));

  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Stub server did not bind to a TCP port');
  }

  origin = `http://${host}:${address.port}`;

  return {
    origin,
    logFile,
    server,
    requests: () => [...recorded],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stub = await startStubServer({ port: Number(process.env.PORT ?? 8787) });
  console.log(`Stub listening on ${stub.origin}, logging to ${stub.logFile}`);
}
