import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

const INFO_URL = 'https://mozilla.github.io/ecosystem-platform/api#section/Response-format';

export interface IFxaErrorBody {
  code: number;
  errno: number;
  error: string;
  message: string;
  info: string;
  [extra: string]: unknown;
}

/** An error in Mozilla's accounts format (fxa/libs/accounts/errors/src/app-error.ts); the HTTP status is `code`. */
export class FxaError extends HttpException {
  readonly body: IFxaErrorBody;

  constructor(code: number, errno: number, message: string, extra: Record<string, unknown> = {}) {
    const body: IFxaErrorBody = {
      ...extra,
      code,
      errno,
      error: STATUS_CODES[code] ?? 'Error',
      message,
      info: INFO_URL,
    };

    super(body, code);

    this.body = body;
  }
}

/** Errnos from fxa/libs/accounts/errors/src/constants.ts. */
export const fxaErrors = {
  accountExists: (email: string) => new FxaError(400, 101, 'Account already exists', { email }),
  unknownAccount: (email?: string) => new FxaError(400, 102, 'Unknown account', { email }),
  incorrectPassword: () => new FxaError(400, 103, 'Incorrect password'),
  invalidJson: () => new FxaError(400, 106, 'Invalid JSON in request body'),
  invalidParameter: (validation?: unknown) =>
    new FxaError(400, 107, 'Invalid parameter in request body', { validation }),
  missingParameter: (param?: string) =>
    new FxaError(400, 108, `Missing parameter in request body${param === undefined ? '' : `: ${param}`}`, { param }),
  invalidToken: (message = 'Invalid authentication token in request signature') => new FxaError(401, 110, message),
  /**
   * `retryAfter` in seconds, as Firefox reads it (FxAccountsClient.sys.mjs); the exception filter sends it as
   * `Retry-After` too.
   */
  throttled: (retryAfter: number) => new FxaError(429, 114, 'Client has sent too many requests', { retryAfter }),
  incorrectEmailCase: (email: string) => new FxaError(400, 120, 'Incorrect email case', { email }),
  unknownDevice: () => new FxaError(400, 123, 'Unknown device'),
  deviceSessionConflict: (deviceId: string) =>
    new FxaError(400, 124, 'Session already registered by another device', { deviceId }),
  unknownClientId: (clientId: string) => new FxaError(400, 162, 'Unknown client_id', { clientId }),
  invalidScopes: (invalidScopes: string) =>
    new FxaError(400, 163, 'Requested scopes are not allowed', { invalidScopes }),
  incorrectRedirectUri: (redirectUri: string) => new FxaError(400, 167, 'Incorrect redirect URI', { redirectUri }),
  invalidResponseType: () => new FxaError(400, 168, 'Invalid response_type'),
  missingPkceParameters: () => new FxaError(400, 169, 'Public clients require PKCE OAuth parameters'),
  unknownAuthorizationCode: () => new FxaError(400, 172, 'Unknown authorization code'),
  mismatchAuthorizationCode: (clientId: string) =>
    new FxaError(400, 173, 'Mismatched authorization code', { clientId }),
  expiredAuthorizationCode: (expiredAt: number) => new FxaError(400, 174, 'Expired authorization code', { expiredAt }),
  invalidPkceChallenge: () => new FxaError(400, 175, 'Public clients require PKCE OAuth parameters'),
  unknownRefreshToken: () => new FxaError(400, 182, 'Unknown refresh token'),
  invalidInvite: () => new FxaError(400, 207, 'Account creation rejected: the invite is invalid or has expired'),
  accountDisabled: () => new FxaError(400, 240, 'Account disabled'),
  /** Ours, outside Mozilla's range: only our own sign-in page reads it. */
  setupRequired: () =>
    new FxaError(400, 250, 'Finish setting up this account in the web app first: change its default password'),
  unexpected: () => new FxaError(500, 999, 'Unspecified error'),
};
