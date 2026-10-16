import {
  API_PATH_PREFIX,
  AUTH_PATH_PREFIX,
  OAUTH_PATH_PREFIX,
  PROFILE_PATH_PREFIX,
  STORAGE_PATH_PREFIX,
  TOKENSERVER_PATH_PREFIX,
  WELL_KNOWN_PATH_PREFIX,
} from '@libs/dto';

/** Which surface a request is for, which each policy that differs between them dispatches on. */
export enum RequestSurface {
  /** The management API the web app calls. */
  API = 'api',

  /** Mozilla's accounts servers: auth, OAuth, profile and discovery, all answering errors with an `errno`. */
  ACCOUNTS = 'accounts',

  TOKENSERVER = 'tokenserver',

  STORAGE = 'storage',

  /** Anything else, such as the web app's own pages. */
  OTHER = 'other',
}

const SURFACE_PREFIXES: [string, RequestSurface][] = [
  [API_PATH_PREFIX, RequestSurface.API],
  [AUTH_PATH_PREFIX, RequestSurface.ACCOUNTS],
  [OAUTH_PATH_PREFIX, RequestSurface.ACCOUNTS],
  [PROFILE_PATH_PREFIX, RequestSurface.ACCOUNTS],
  [WELL_KNOWN_PATH_PREFIX, RequestSurface.ACCOUNTS],
  [TOKENSERVER_PATH_PREFIX, RequestSurface.TOKENSERVER],
  [STORAGE_PATH_PREFIX, RequestSurface.STORAGE],
];

/** Express routes without regard to case, so a path matches its prefix the same way. */
export function requestSurface(path: string): RequestSurface {
  const lowerPath = path.toLowerCase();
  const match = SURFACE_PREFIXES.find(([prefix]) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`));

  return match?.[1] ?? RequestSurface.OTHER;
}

/** A request as `RequestSurfaceGuard` stamped it; a request no route took carries no stamp. */
export interface ISurfacedRequest {
  path: string;
  surface?: RequestSurface;
}

/** The surfaces Firefox itself calls, each authenticating with its own tokens on the routes that need them. */
export const isFirefoxSurface = (surface: RequestSurface): boolean =>
  surface === RequestSurface.ACCOUNTS || surface === RequestSurface.TOKENSERVER || surface === RequestSurface.STORAGE;
