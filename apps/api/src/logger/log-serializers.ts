import { omit } from 'lodash';
import { IncomingMessage } from 'node:http';
import { stdSerializers } from 'pino-http';

import { clientAddress } from '@/common/client-address';

interface ISerializedError {
  type: string;
  message: string;
  stack: string;
  code?: unknown;
}

const TOKEN_PAGE_PATTERN = /^\/(invite|reset-password)\/[^/?#]+/i;

const isSerializedError = (value: unknown): value is ISerializedError =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string' &&
  'message' in value &&
  typeof value.message === 'string' &&
  'stack' in value &&
  typeof value.stack === 'string';

/**
 * Drops every property but the type, message, stack and code, since others hold secrets: a `QueryFailedError` carries
 * the query's parameters, and a validation `HttpException` the request body. pino-http hands it pino's serialized form.
 */
export function serializeError(value: unknown): unknown {
  const serialized: unknown = value instanceof Error ? stdSerializers.err(value) : value;

  if (!isSerializedError(serialized)) {
    return value;
  }

  const { type, message, stack, code } = serialized;

  return typeof code === 'string' || typeof code === 'number'
    ? { type, message, stack, code }
    : { type, message, stack };
}

const redactUrl = (url: string): string => url.replace(TOKEN_PAGE_PATTERN, '/$1/[redacted]');

/** The path of an origin-form or absolute-form request target, without its query. */
function pathOf(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?')[0];
  }
}

/**
 * Masks the token in the web app's invite and password reset page paths, and drops `params`, which repeats the path's segments when the
 * web app's catch-all route took the request.
 */
export function serializeReceivedRequest(req: IncomingMessage): Record<string, unknown> {
  const request = stdSerializers.req(req);

  return { ...omit(request, 'params'), url: redactUrl(request.url) };
}

/**
 * The method and masked path, without the query, so a filter on the path cannot be thrown off by what a client puts in
 * the query.
 */
export function serializeCompletedRequest(req: IncomingMessage): { method: string; path: string } {
  const { method, url } = stdSerializers.req(req);

  return { method, path: redactUrl(pathOf(url)) };
}

/** The client Express names after `TRUST_PROXY`, which the socket's `remoteAddress` is not behind a proxy. */
export function serializeClient(req: IncomingMessage): string | undefined {
  return 'ip' in req && typeof req.ip === 'string' ? clientAddress(req.ip) : undefined;
}
