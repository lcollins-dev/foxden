export const API_PATH_PREFIX = '/api/v1';
export const AUTH_PATH_PREFIX = '/auth/v1';
export const OAUTH_PATH_PREFIX = '/oauth/v1';
export const PROFILE_PATH_PREFIX = '/profile/v1';
export const TOKENSERVER_PATH_PREFIX = '/token';
export const STORAGE_PATH_PREFIX = '/storage';
export const WELL_KNOWN_PATH_PREFIX = '/.well-known';

/**
 * The api answers every path under these prefixes itself: the web app's SPA fallback returns 404 under them, and
 * the Vite dev server proxies each one to the api. Firefox reaches all of them on the web app's origin.
 */
export const SERVER_PATH_PREFIXES: readonly string[] = [
  API_PATH_PREFIX,
  AUTH_PATH_PREFIX,
  OAUTH_PATH_PREFIX,
  PROFILE_PATH_PREFIX,
  TOKENSERVER_PATH_PREFIX,
  STORAGE_PATH_PREFIX,
  WELL_KNOWN_PATH_PREFIX,
];
