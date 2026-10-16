export type TokenserverRefusal =
  | { reason: 'invalid-credentials' }
  | { reason: 'unavailable' }
  | { reason: 'invalid-generation' }
  | { reason: 'invalid-keys-changed-at' }
  | { reason: 'empty-client-state' }
  | { reason: 'stale-client-state' }
  | { reason: 'client-state-without-generation-change' }
  | { reason: 'client-state-without-keys-changed-at-change' };

export class TokenserverRefusedError extends Error {
  constructor(readonly refusal: TokenserverRefusal) {
    super(`Tokenserver refused: ${refusal.reason}`);
  }
}
