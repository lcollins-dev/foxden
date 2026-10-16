import { Response } from 'express';

import { formatTimestamp } from './weave-timestamp';
import { PreconditionFailedError } from '@/core/storage/storage-refusal';

export const JSON_CONTENT_TYPE = 'application/json';
export const NEWLINES_CONTENT_TYPE = 'application/newlines';

export interface IStorageResponse {
  status: number;
  /** Serialised already, because sync timestamps need two decimals `JSON.stringify` cannot promise. */
  body: string | null;
  contentType: string;
  /** Milliseconds; the request start, or the write timestamp for a write. */
  serverTime: number;
  lastModified: number | null;
  records: number | null;
  nextOffset: string | null;
  retryAfterSeconds: number | null;
}

type ResponseOptions = Partial<Omit<IStorageResponse, 'status' | 'body' | 'serverTime'>>;

export const storageResponse = (
  status: number,
  body: string | null,
  serverTime: number,
  options: ResponseOptions = {}
): IStorageResponse => ({
  status,
  body,
  serverTime,
  contentType: options.contentType ?? JSON_CONTENT_TYPE,
  lastModified: options.lastModified ?? null,
  records: options.records ?? null,
  nextOffset: options.nextOffset ?? null,
  retryAfterSeconds: options.retryAfterSeconds ?? null,
});

/** A 304 for `X-If-Modified-Since`, a 412 for `X-If-Unmodified-Since`, both without a body. */
export const preconditionResponse = (error: PreconditionFailedError, serverTime: number): IStorageResponse =>
  storageResponse(error.precondition === 'if-modified-since' ? 304 : 412, null, serverTime, {
    lastModified: error.lastModified,
  });

/**
 * Writes the response with the headers Firefox reads. `X-Weave-Timestamp` never trails `X-Last-Modified`
 * (syncstorage-rs `set_weave_timestamp`, `syncserver/src/web/middleware/weave.rs`).
 */
export function sendStorageResponse(res: Response, response: IStorageResponse): void {
  res.status(response.status);
  res.setHeader('X-Weave-Timestamp', formatTimestamp(Math.max(response.serverTime, response.lastModified ?? 0)));

  if (response.lastModified !== null) {
    res.setHeader('X-Last-Modified', formatTimestamp(response.lastModified));
  }

  if (response.records !== null) {
    res.setHeader('X-Weave-Records', String(response.records));
  }

  if (response.nextOffset !== null) {
    res.setHeader('X-Weave-Next-Offset', response.nextOffset);
  }

  if (response.retryAfterSeconds !== null) {
    res.setHeader('Retry-After', String(response.retryAfterSeconds));
  }

  if (response.body === null) {
    res.end();
    return;
  }

  res.setHeader('Content-Type', response.contentType);
  res.send(response.body);
}
