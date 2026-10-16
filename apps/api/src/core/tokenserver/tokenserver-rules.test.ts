import { describe, expect, it } from 'vitest';

import { TokenserverRefusedError } from './tokenserver-refusal';
import { ICurrentUser, IRequestKeys, RETIRED_GENERATION, nextUserKeys, validateRequestKeys } from './tokenserver-rules';

const user = (fields: Partial<ICurrentUser> = {}): ICurrentUser => ({
  uid: 1,
  generation: 0,
  keysChangedAt: null,
  clientState: 'aaaa',
  oldClientStates: [],
  ...fields,
});

const keys = (fields: Partial<IRequestKeys> = {}): IRequestKeys => ({
  generation: null,
  keysChangedAt: null,
  clientState: 'aaaa',
  ...fields,
});

const rejection = (request: IRequestKeys, current: ICurrentUser): string | null => {
  try {
    validateRequestKeys(request, current);

    return null;
  } catch (error) {
    if (error instanceof TokenserverRefusedError) {
      return error.refusal.reason;
    }

    throw error;
  }
};

describe('validateRequestKeys', () => {
  it('refuses every request against a retired account, with or without a generation claim', () => {
    const retired = user({ generation: RETIRED_GENERATION, keysChangedAt: 1700 });

    expect(rejection(keys({ keysChangedAt: 1700 }), retired)).toBe('invalid-generation');
    expect(rejection(keys({ generation: 1800, keysChangedAt: 1700 }), retired)).toBe('invalid-generation');
    expect(rejection(keys({ generation: RETIRED_GENERATION, keysChangedAt: 1700 }), retired)).toBe(
      'invalid-generation'
    );
    expect(rejection(keys({ generation: 1800, keysChangedAt: 1800, clientState: 'bbbb' }), retired)).toBe(
      'invalid-generation'
    );
  });

  it('accepts the normal Firefox lifecycle: same keys again', () => {
    expect(rejection(keys({ keysChangedAt: 1700 }), user({ keysChangedAt: 1700 }))).toBeNull();
  });

  it('accepts a password reset: new client state with a raised keys_changed_at', () => {
    expect(rejection(keys({ keysChangedAt: 1800, clientState: 'bbbb' }), user({ keysChangedAt: 1700 }))).toBeNull();
  });

  // Error precedence asserted by syncstorage-rs tools/integration_tests/tokenserver/test_authorization.py.
  it('rejects keys_changed_at raised beyond the generation before any client-state error', () => {
    expect(
      rejection(keys({ generation: 1234, keysChangedAt: 2345, clientState: '' }), user({ keysChangedAt: 1234 }))
    ).toBe('invalid-keys-changed-at');
  });

  it('rejects an empty client state after a real one', () => {
    expect(rejection(keys({ clientState: '', keysChangedAt: 2 }), user({ keysChangedAt: 1 }))).toBe(
      'empty-client-state'
    );
  });

  it('rejects a stale client state before a missing generation change', () => {
    expect(
      rejection(keys({ generation: 1, clientState: 'bbbb' }), user({ generation: 5, oldClientStates: ['bbbb'] }))
    ).toBe('stale-client-state');
  });

  it('rejects a new client state without a generation change before one without a keys_changed_at change', () => {
    expect(
      rejection(
        keys({ generation: 5, keysChangedAt: 5, clientState: 'bbbb' }),
        user({ generation: 5, keysChangedAt: 5 })
      )
    ).toBe('client-state-without-generation-change');
    expect(rejection(keys({ keysChangedAt: 5, clientState: 'bbbb' }), user({ keysChangedAt: 5 }))).toBe(
      'client-state-without-keys-changed-at-change'
    );
  });

  it('rejects a generation or keys_changed_at going backwards', () => {
    expect(rejection(keys({ generation: 4 }), user({ generation: 5 }))).toBe('invalid-generation');
    expect(rejection(keys({ keysChangedAt: 4 }), user({ keysChangedAt: 5 }))).toBe('invalid-keys-changed-at');
  });

  it('requires keys_changed_at once one was seen, unless it was zero', () => {
    expect(rejection(keys(), user({ keysChangedAt: 5 }))).toBe('invalid-keys-changed-at');
    expect(rejection(keys(), user({ keysChangedAt: 0 }))).toBeNull();
  });

  it('allows initialising keys_changed_at below the stored generation (test_kid_change_during_gradual_tokenserver_rollout)', () => {
    expect(rejection(keys({ generation: 1234, keysChangedAt: 1200 }), user({ generation: 1234 }))).toBeNull();
  });
});

describe('nextUserKeys', () => {
  it('takes a reported generation and keys_changed_at', () => {
    expect(nextUserKeys(keys({ generation: 1234, keysChangedAt: 1234 }), user())).toEqual({
      generation: 1234,
      keysChangedAt: 1234,
    });
  });

  it('uses a raised keys_changed_at as the generation when none is reported', () => {
    expect(nextUserKeys(keys({ keysChangedAt: 1800 }), user({ keysChangedAt: 1700 }))).toEqual({
      generation: 1800,
      keysChangedAt: 1800,
    });
    expect(nextUserKeys(keys({ keysChangedAt: 1700 }), user())).toEqual({ generation: 1700, keysChangedAt: 1700 });
  });

  it('keeps the generation when keys_changed_at does not rise above it', () => {
    expect(nextUserKeys(keys({ keysChangedAt: 1700 }), user({ generation: 2000, keysChangedAt: 1700 }))).toEqual({
      generation: 2000,
      keysChangedAt: 1700,
    });
  });

  it('keeps a stored zero keys_changed_at when none is sent', () => {
    expect(nextUserKeys(keys(), user({ keysChangedAt: 0 }))).toEqual({ generation: 0, keysChangedAt: 0 });
    expect(nextUserKeys(keys(), user())).toEqual({ generation: 0, keysChangedAt: null });
  });
});
