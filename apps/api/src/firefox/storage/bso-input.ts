import { storageErrors } from './storage-error';
import { NEWLINES_CONTENT_TYPE } from './storage-response';
import { IBsoInput } from '@/core/storage/bso';
import {
  BSO_ID_PATTERN,
  MAX_SORTINDEX,
  MAX_TTL_SECONDS,
  MIN_SORTINDEX,
  STORAGE_LIMITS,
} from '@/core/storage/storage-limits';

export interface IPostItems {
  valid: IBsoInput[];
  failed: Record<string, string>;
}

// `modified` and `collection` are accepted and ignored: Firefox echoes them when it re-uploads `meta/global`.
const KNOWN_FIELDS = new Set(['id', 'sortindex', 'payload', 'ttl', 'modified', 'collection']);

// A crypto/keys record with an all-zero IV, which old clients wrote (syncstorage-rs `KNOWN_BAD_PAYLOAD_REGEX`).
const KNOWN_BAD_PAYLOAD_PATTERN = /IV":\s*"AAAAAAAAAAAAAAAAAAAAAA==/;
const KNOWN_BAD_PAYLOAD_COLLECTION = 'crypto';

type FieldCheck = { ok: true; bso: IBsoInput } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const payloadBytes = (bso: IBsoInput): number => Buffer.byteLength(bso.payload ?? '', 'utf8');

export const mediaType = (contentType: string | undefined): string =>
  (contentType ?? '').split(';')[0].trim().toLowerCase();

function checkInteger(value: unknown, min: number, max: number, name: string): number | null | string {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return 'invalid json';
  }

  return value >= min && value <= max ? value : `invalid bso: ${name} out of range`;
}

export function checkBsoFields(value: Record<string, unknown>, id: string): FieldCheck {
  const unknownField = Object.keys(value).find(key => !KNOWN_FIELDS.has(key));

  if (unknownField !== undefined) {
    return { ok: false, reason: `unknown field ${unknownField}` };
  }

  if (value.id !== undefined && typeof value.id !== 'string') {
    return { ok: false, reason: 'invalid json' };
  }

  if (!BSO_ID_PATTERN.test(id) || (typeof value.id === 'string' && !BSO_ID_PATTERN.test(value.id))) {
    return { ok: false, reason: 'invalid bso: invalid id' };
  }

  if (value.payload !== undefined && value.payload !== null && typeof value.payload !== 'string') {
    return { ok: false, reason: 'invalid json' };
  }

  const sortindex = checkInteger(value.sortindex, MIN_SORTINDEX, MAX_SORTINDEX, 'sortindex');
  const ttl = checkInteger(value.ttl, 0, MAX_TTL_SECONDS, 'ttl');

  if (typeof sortindex === 'string') {
    return { ok: false, reason: sortindex };
  }

  if (typeof ttl === 'string') {
    return { ok: false, reason: ttl };
  }

  const payload = typeof value.payload === 'string' ? value.payload : null;

  return { ok: true, bso: { id, sortindex, payload, ttl } };
}

function rejectKnownBadPayloads(collection: string, bsos: IBsoInput[]): void {
  if (
    collection === KNOWN_BAD_PAYLOAD_COLLECTION &&
    bsos.some(bso => bso.payload !== null && KNOWN_BAD_PAYLOAD_PATTERN.test(bso.payload))
  ) {
    throw storageErrors.invalidBso();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw storageErrors.invalidBso();
  }
}

/** The body of a BSO PUT. Every content type but `application/newlines` is read as JSON. */
export function parsePutBody(body: Buffer, contentType: string | undefined, collection: string, id: string): IBsoInput {
  if (mediaType(contentType) === NEWLINES_CONTENT_TYPE) {
    throw storageErrors.invalidBso();
  }

  const value = parseJson(body.toString('utf8'));

  if (!isRecord(value)) {
    throw storageErrors.invalidBso();
  }

  const checked = checkBsoFields(value, id);

  if (!checked.ok || payloadBytes(checked.bso) > STORAGE_LIMITS.max_record_payload_bytes) {
    throw storageErrors.invalidBso();
  }

  rejectKnownBadPayloads(collection, [checked.bso]);

  return checked.bso;
}

/** `str::lines` in Rust: a final newline adds no item, and a trailing `\r` is dropped. */
function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }

  const lines = text.split('\n');

  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.map(line => line.replace(/\r$/, ''));
}

function parsePostArray(body: Buffer, contentType: string | undefined): unknown[] {
  const text = body.toString('utf8');

  if (mediaType(contentType) === NEWLINES_CONTENT_TYPE) {
    return splitLines(text).map(parseJson);
  }

  const value = parseJson(text);

  if (!Array.isArray(value)) {
    throw storageErrors.invalidBso();
  }

  return value;
}

/**
 * The body of a collection POST, in syncstorage-rs's order (`extractors/bso_bodies.rs`,
 * `collection_post_request.rs`): a malformed request fails whole, a bad item fails alone in `failed`.
 */
export function parsePostBody(body: Buffer, contentType: string | undefined, collection: string): IPostItems {
  const items = parsePostArray(body, contentType);
  const seenIds = new Set<string>();
  const records: { id: string; value: Record<string, unknown> }[] = [];

  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string' || seenIds.has(item.id)) {
      throw storageErrors.invalidBso();
    }

    seenIds.add(item.id);
    records.push({ id: item.id, value: item });
  }

  const failed: Record<string, string> = {};
  let valid: IBsoInput[] = [];
  let totalBytes = 0;

  for (const record of records) {
    const checked = checkBsoFields(record.value, record.id);

    if (!checked.ok) {
      failed[record.id] = checked.reason;
      continue;
    }

    const bytes = payloadBytes(checked.bso);
    totalBytes += bytes;

    if (bytes > STORAGE_LIMITS.max_record_payload_bytes || totalBytes > STORAGE_LIMITS.max_post_bytes) {
      failed[record.id] = 'retry bytes';
      continue;
    }

    valid.push(checked.bso);
  }

  rejectKnownBadPayloads(collection, valid);

  if (valid.length > STORAGE_LIMITS.max_post_records) {
    for (const excess of valid.slice(STORAGE_LIMITS.max_post_records)) {
      failed[excess.id] = 'retry bso';
    }

    valid = valid.slice(0, STORAGE_LIMITS.max_post_records);
  }

  return { valid, failed };
}
