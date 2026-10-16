export type AccountRefusal =
  | { reason: 'invalid-invite' }
  | { reason: 'account-exists'; email: string }
  | { reason: 'unknown-account'; email: string }
  | { reason: 'account-disabled' }
  | { reason: 'incorrect-password' }
  | { reason: 'incorrect-email-case'; storedEmail: string }
  | { reason: 'invalid-key-fetch-token' }
  | { reason: 'invalid-password-change-token' }
  | { reason: 'invalid-session-token' }
  | { reason: 'setup-required' };

/** Why a sign-up, sign-in, key fetch or password change was refused; each entry point words it in its own error format. */
export class AccountRefusedError extends Error {
  constructor(readonly refusal: AccountRefusal) {
    super(`Account refused: ${refusal.reason}`);
  }
}
