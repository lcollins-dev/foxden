/**
 * Served as `info/configuration`, and Firefox sizes its uploads by it. Defaults of syncstorage-rs
 * (`syncstorage-settings/src/lib.rs`, `ServerLimits::default`).
 */
export const STORAGE_LIMITS = {
  max_post_bytes: 2621440,
  max_post_records: 100,
  max_record_payload_bytes: 2621440,
  max_request_bytes: 2625536,
  max_total_bytes: 262144000,
  max_total_records: 10000,
  max_quota_limit: 2097152000,
};

export const BATCH_LIFETIME_MS = 2 * 60 * 60 * 1000;

export const MAX_IDS_PER_REQUEST = 100;

export const COLLECTION_PATTERN = /^[a-zA-Z0-9._-]{1,32}$/;
export const BSO_ID_PATTERN = /^[ -~]{1,64}$/;

export const MIN_SORTINDEX = -999999999;
export const MAX_SORTINDEX = 999999999;
export const MAX_TTL_SECONDS = 999999999;
