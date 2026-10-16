import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reloadOnce } from './reloadOnce';

describe('reloadOnce', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ reload } as unknown as Location);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reloads the first time for a key and not again', () => {
    expect(reloadOnce('state-1')).toBe(true);
    expect(reloadOnce('state-1')).toBe(false);
    expect(reloadOnce('state-2')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when session storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });

    expect(reloadOnce('state-1')).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
