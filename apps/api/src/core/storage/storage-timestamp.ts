/**
 * Sync timestamps are integer milliseconds, always a multiple of 10 (syncstorage-rs `SyncTimestamp`,
 * `syncstorage-db-common/src/util.rs`).
 */
export const TIMESTAMP_RESOLUTION_MS = 10;

export const floorTimestamp = (ms: number): number => ms - (ms % TIMESTAMP_RESOLUTION_MS);

/** Strictly later than every earlier write of the user, even when the clock steps back. */
export const nextWriteTimestamp = (nowMs: number, storageModifiedMs: number): number =>
  Math.max(floorTimestamp(nowMs), storageModifiedMs + TIMESTAMP_RESOLUTION_MS);
