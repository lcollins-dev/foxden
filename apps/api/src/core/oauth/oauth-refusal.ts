export type OauthRefusal =
  | { reason: 'unknown-client'; clientId: string }
  | { reason: 'invalid-scopes'; invalidScopes: string }
  | { reason: 'unknown-authorization-code' }
  | { reason: 'mismatched-authorization-code'; clientId: string }
  | { reason: 'expired-authorization-code'; expiredAt: number }
  | { reason: 'invalid-pkce-challenge' }
  | { reason: 'account-disabled' }
  | { reason: 'setup-required' }
  | { reason: 'invalid-refresh-token' };

export class OauthRefusedError extends Error {
  constructor(readonly refusal: OauthRefusal) {
    super(`OAuth refused: ${refusal.reason}`);
  }
}
