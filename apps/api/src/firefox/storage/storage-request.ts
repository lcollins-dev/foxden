import { IncomingHttpHeaders } from 'node:http';

import { BatchMode, IPreconditions } from '@/core/storage/storage.service';

import { storageErrors } from './storage-error';
import { parseTimestamp } from './weave-timestamp';
import { STORAGE_LIMITS } from '@/core/storage/storage-limits';

const INTEGER_PATTERN = /^[0-9]+$/;
const TRUE_PATTERN = /^true$/i;

export type ListFormat = 'json' | 'newlines';

const headerValue = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name];

  return Array.isArray(value) ? value.join(', ') : value;
};

function parsePreconditionHeader(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = parseTimestamp(value);

  if (parsed === null) {
    throw storageErrors.badRequest();
  }

  return parsed;
}

/** Sending both is a 400 (syncstorage-rs `PreConditionHeaderOpt`, `extractors/precondition_header.rs`). */
export function parsePreconditions(headers: IncomingHttpHeaders): IPreconditions {
  const ifModifiedSince = headerValue(headers, 'x-if-modified-since');
  const ifUnmodifiedSince = headerValue(headers, 'x-if-unmodified-since');

  if (ifModifiedSince !== undefined && ifUnmodifiedSince !== undefined) {
    throw storageErrors.badRequest();
  }

  return {
    ifModifiedSince: parsePreconditionHeader(ifModifiedSince),
    ifUnmodifiedSince: parsePreconditionHeader(ifUnmodifiedSince),
  };
}

export function parseBatchMode(params: URLSearchParams): BatchMode {
  const batch = params.get('batch');
  const commit = params.get('commit');

  if (commit !== null && (batch === null || !TRUE_PATTERN.test(commit))) {
    throw storageErrors.badRequest();
  }

  if (batch === null) {
    return { kind: 'none' };
  }

  if (batch === '' || TRUE_PATTERN.test(batch)) {
    return { kind: 'create', commit: commit !== null };
  }

  return { kind: 'append', batchId: batch, commit: commit !== null };
}

const POST_LIMIT_HEADERS: [string, number][] = [
  ['x-weave-records', STORAGE_LIMITS.max_post_records],
  ['x-weave-bytes', STORAGE_LIMITS.max_post_bytes],
  ['x-weave-total-records', STORAGE_LIMITS.max_total_records],
  ['x-weave-total-bytes', STORAGE_LIMITS.max_total_bytes],
];

export function checkPostLimitHeaders(headers: IncomingHttpHeaders): void {
  for (const [name, limit] of POST_LIMIT_HEADERS) {
    const value = headerValue(headers, name);

    if (value === undefined) {
      continue;
    }

    if (!INTEGER_PATTERN.test(value.trim())) {
      throw storageErrors.badRequest();
    }

    if (Number(value) > limit) {
      throw storageErrors.sizeLimitHeader();
    }
  }
}

/**
 * The output format for a collection listing (syncstorage-rs `get_accepted`, `extractors/utils.rs`): the most
 * preferred acceptable type wins, `*` and a missing header mean JSON, and `text/plain` is refused.
 */
export function negotiateListFormat(accept: string | undefined): ListFormat {
  if (accept === undefined || accept.trim() === '') {
    return 'json';
  }

  const ranges = accept
    .split(',')
    .map((range, index) => {
      const [type, ...parameters] = range.split(';').map(part => part.trim().toLowerCase());
      const quality = parameters.find(parameter => parameter.startsWith('q='));

      return { type, quality: quality === undefined ? 1 : Number(quality.slice(2)), index };
    })
    .filter(range => !Number.isNaN(range.quality) && range.quality > 0)
    .sort((left, right) => (right.quality !== left.quality ? right.quality - left.quality : left.index - right.index));

  for (const range of ranges) {
    if (range.type === '*/*' || range.type === 'application/*' || range.type === 'application/json') {
      return 'json';
    }

    if (range.type === 'application/newlines') {
      return 'newlines';
    }

    if (range.type === 'text/plain' || range.type === 'text/*') {
      throw storageErrors.notAcceptable();
    }
  }

  throw storageErrors.notAcceptable();
}
