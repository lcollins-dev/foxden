import { StorageRefusal } from '@/core/storage/storage-refusal';

/** WEAVE error codes, sent as a bare JSON number (syncstorage-rs `WeaveError`, `syncserver/src/error.rs`). */
export enum WeaveErrorCode {
  UNKNOWN = 0,
  INVALID_BSO = 8,
  SIZE_LIMIT_EXCEEDED = 17,
}

/** The Retry-After syncstorage-rs sends with a 503 (`RETRY_AFTER`, `syncserver/src/error.rs`). */
export const RETRY_AFTER_SECONDS = 10;

export class StorageError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly weaveCode: WeaveErrorCode = WeaveErrorCode.UNKNOWN,
    readonly retryAfterSeconds: number | null = null
  ) {
    super(`Storage error ${httpStatus} (${weaveCode})`);
  }
}

export const storageErrors = {
  badRequest: () => new StorageError(400),
  invalidBso: () => new StorageError(400, WeaveErrorCode.INVALID_BSO),
  sizeLimitHeader: () => new StorageError(400, WeaveErrorCode.SIZE_LIMIT_EXCEEDED),
  unauthorized: () => new StorageError(401),
  notFound: () => new StorageError(404),
  methodNotAllowed: () => new StorageError(405),
  notAcceptable: () => new StorageError(406),
  bodyTooLarge: () => new StorageError(413, WeaveErrorCode.SIZE_LIMIT_EXCEEDED),
  unavailable: () => new StorageError(503, WeaveErrorCode.UNKNOWN, RETRY_AFTER_SECONDS),
  internal: () => new StorageError(500),
};

export function storageErrorFor(refusal: StorageRefusal): StorageError {
  switch (refusal.reason) {
    case 'stale-uid':
      return storageErrors.unauthorized();
    case 'not-found':
      return storageErrors.notFound();
    case 'batch-closed':
      return storageErrors.badRequest();
    case 'batch-too-large':
      return storageErrors.sizeLimitHeader();
  }
}

const PAYLOAD_TOO_LARGE = 413;

const hasStatus = (value: unknown): value is { status: number } =>
  typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'number';

/** The answer to a body the parser refused: too large, or anything else it could not read. */
export const storageBodyError = (error: unknown): StorageError =>
  hasStatus(error) && error.status === PAYLOAD_TOO_LARGE ? storageErrors.bodyTooLarge() : storageErrors.badRequest();
