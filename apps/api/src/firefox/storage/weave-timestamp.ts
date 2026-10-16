import { TIMESTAMP_RESOLUTION_MS } from '@/core/storage/storage-timestamp';

const DECIMAL_PATTERN = /^([0-9]+\.?[0-9]*|\.[0-9]+)$/;

/** Seconds with exactly two decimals (syncstorage-rs `SyncTimestamp`, `syncstorage-db-common/src/util.rs`). */
export function formatTimestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hundredths = Math.floor((ms % 1000) / TIMESTAMP_RESOLUTION_MS);

  return `${seconds}.${String(hundredths).padStart(2, '0')}`;
}

export function parseTimestamp(text: string): number | null {
  const trimmed = text.trim();

  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }

  const ms = Math.round(Number(trimmed) * 100) * TIMESTAMP_RESOLUTION_MS;

  return Number.isSafeInteger(ms) ? ms : null;
}
