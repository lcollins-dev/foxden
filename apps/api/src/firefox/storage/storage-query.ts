import { storageErrors } from './storage-error';
import { parseTimestamp } from './weave-timestamp';
import { BSO_ID_PATTERN, MAX_IDS_PER_REQUEST } from '@/core/storage/storage-limits';
import { BsoSort, IBsoListOptions } from '@/core/storage/storage-query';

const UNSIGNED_PATTERN = /^[0-9]+$/;
const MAX_U32 = 4294967295;

export const queryParams = (originalUrl: string): URLSearchParams => {
  const start = originalUrl.indexOf('?');

  return new URLSearchParams(start === -1 ? '' : originalUrl.slice(start + 1));
};

export function parseIds(value: string): string[] {
  const ids = value
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '');

  if (ids.length > MAX_IDS_PER_REQUEST || ids.some(id => !BSO_ID_PATTERN.test(id))) {
    throw storageErrors.badRequest();
  }

  return ids;
}

function parseUnsigned(value: string, max: number): number {
  const parsed = Number(value);

  if (!UNSIGNED_PATTERN.test(value) || parsed > max) {
    throw storageErrors.badRequest();
  }

  return parsed;
}

function parseOptionalTimestamp(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = parseTimestamp(value);

  if (parsed === null) {
    throw storageErrors.badRequest();
  }

  return parsed;
}

function parseSort(value: string | null): BsoSort {
  if (value === null || value === 'newest') {
    return 'newest';
  }

  if (value === 'oldest' || value === 'index') {
    return value;
  }

  throw storageErrors.badRequest();
}

/** Unknown parameters, such as Firefox's daily `v=`, are ignored (syncstorage-rs `BsoQueryParams`). */
export function parseBsoListOptions(params: URLSearchParams): IBsoListOptions {
  const ids = params.get('ids');
  const limit = params.get('limit');
  const offset = params.get('offset');

  return {
    ids: ids === null ? null : parseIds(ids),
    newer: parseOptionalTimestamp(params.get('newer')),
    older: parseOptionalTimestamp(params.get('older')),
    full: params.has('full'),
    limit: limit === null ? null : parseUnsigned(limit, MAX_U32),
    offset: offset === null ? 0 : parseUnsigned(offset, Number.MAX_SAFE_INTEGER),
    sort: parseSort(params.get('sort')),
  };
}
