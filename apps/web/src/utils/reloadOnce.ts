const RELOADED_PREFIX = 'foxden.reloaded:';

/** Reloads the page unless it already did so for `key` in this tab; true when it reloads. */
export function reloadOnce(key: string): boolean {
  try {
    if (sessionStorage.getItem(`${RELOADED_PREFIX}${key}`) !== null) {
      return false;
    }

    sessionStorage.setItem(`${RELOADED_PREFIX}${key}`, '1');
  } catch {
    return false;
  }

  window.location.reload();

  return true;
}
