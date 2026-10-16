import { TokenserverRefusal } from '@/core/tokenserver/tokenserver-refusal';

export type TokenserverErrorLocation = 'header' | 'url' | 'body' | 'internal';

export interface ITokenserverErrorBody {
  status: string;
  errors: { location: TokenserverErrorLocation; name: string; description: string }[];
}

export class TokenserverError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly status: string,
    readonly location: TokenserverErrorLocation,
    readonly errorName: string,
    readonly description: string
  ) {
    super(`${status}: ${description}`);
  }

  get body(): ITokenserverErrorBody {
    return {
      status: this.status,
      errors: [{ location: this.location, name: this.errorName, description: this.description }],
    };
  }
}

const UNAUTHORIZED = 'Unauthorized';

export const tokenserverErrors = {
  unauthorized: () => new TokenserverError(401, 'error', 'body', '', UNAUTHORIZED),
  unsupportedScheme: () => new TokenserverError(401, 'error', 'body', '', 'Unsupported'),
  invalidCredentials: () => new TokenserverError(401, 'invalid-credentials', 'body', '', UNAUTHORIZED),
  missingKeyId: () => new TokenserverError(401, 'invalid-key-id', 'header', '', 'Missing X-KeyID header'),
  invalidKeyId: () => new TokenserverError(401, 'invalid-key-id', 'header', '', 'Invalid X-KeyID header'),
  malformedClientState: () =>
    new TokenserverError(400, 'error', 'header', 'X-Client-State', 'Invalid client state value'),
  clientStateMismatch: () => new TokenserverError(401, 'invalid-client-state', 'body', '', UNAUTHORIZED),
  invalidClientState: (description: string) =>
    new TokenserverError(401, 'invalid-client-state', 'header', 'X-Client-State', description),
  invalidGeneration: () => new TokenserverError(401, 'invalid-generation', 'body', '', UNAUTHORIZED),
  invalidKeysChangedAt: () => new TokenserverError(401, 'invalid-keysChangedAt', 'body', '', UNAUTHORIZED),
  unsupportedApplication: () => new TokenserverError(404, 'error', 'url', 'application', 'Unsupported application'),
  unsupportedVersion: (version: string) =>
    new TokenserverError(404, 'error', 'url', version, 'Unsupported application version'),
  unavailable: () => new TokenserverError(503, 'error', 'body', '', 'Resource is not available'),
  internal: () => new TokenserverError(500, 'internal-error', 'internal', '', 'Server error'),
};

/** The error syncstorage-rs answers each core refusal with, description included. */
export function tokenserverErrorFor(refusal: TokenserverRefusal): TokenserverError {
  switch (refusal.reason) {
    case 'invalid-credentials':
      return tokenserverErrors.invalidCredentials();
    case 'unavailable':
      return tokenserverErrors.unavailable();
    case 'invalid-generation':
      return tokenserverErrors.invalidGeneration();
    case 'invalid-keys-changed-at':
      return tokenserverErrors.invalidKeysChangedAt();
    case 'empty-client-state':
      return tokenserverErrors.invalidClientState('Unacceptable client-state value empty string');
    case 'stale-client-state':
      return tokenserverErrors.invalidClientState('Unacceptable client-state value stale value');
    case 'client-state-without-generation-change':
      return tokenserverErrors.invalidClientState(
        'Unacceptable client-state value new value with no generation change'
      );
    case 'client-state-without-keys-changed-at-change':
      return tokenserverErrors.invalidClientState(
        'Unacceptable client-state value new value with no keys_changed_at change'
      );
  }
}
