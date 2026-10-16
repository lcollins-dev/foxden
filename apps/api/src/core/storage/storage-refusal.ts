export type StorageRefusal =
  | { reason: 'stale-uid' }
  | { reason: 'not-found' }
  | { reason: 'batch-closed' }
  | { reason: 'batch-too-large' };

export class StorageRefusedError extends Error {
  constructor(readonly refusal: StorageRefusal) {
    super(`Storage refused: ${refusal.reason}`);
  }
}

export type Precondition = 'if-modified-since' | 'if-unmodified-since';

/** The request's precondition does not hold for the resource, last modified at `lastModified`; nothing was done. */
export class PreconditionFailedError extends Error {
  constructor(
    readonly precondition: Precondition,
    readonly lastModified: number
  ) {
    super(`Precondition ${precondition} failed`);
  }
}
