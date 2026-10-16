import { describe, expect, it } from 'vitest';

import { tokenserverErrorFor } from './tokenserver-error';
import { TokenserverRefusal } from '@/core/tokenserver/tokenserver-refusal';

describe('tokenserverErrorFor', () => {
  it.each<[TokenserverRefusal['reason'], string]>([
    ['invalid-credentials', '401 invalid-credentials body Unauthorized'],
    ['unavailable', '503 error body Resource is not available'],
    ['invalid-generation', '401 invalid-generation body Unauthorized'],
    ['invalid-keys-changed-at', '401 invalid-keysChangedAt body Unauthorized'],
    ['empty-client-state', '401 invalid-client-state header Unacceptable client-state value empty string'],
    ['stale-client-state', '401 invalid-client-state header Unacceptable client-state value stale value'],
    [
      'client-state-without-generation-change',
      '401 invalid-client-state header Unacceptable client-state value new value with no generation change',
    ],
    [
      'client-state-without-keys-changed-at-change',
      '401 invalid-client-state header Unacceptable client-state value new value with no keys_changed_at change',
    ],
  ])('words %s as syncstorage-rs does', (reason, expected) => {
    const error = tokenserverErrorFor({ reason });

    expect(`${error.httpStatus} ${error.status} ${error.location} ${error.description}`).toBe(expected);
  });
});
