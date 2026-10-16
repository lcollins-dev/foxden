export type PasswordResetRefusal = { reason: 'invalid-link' } | { reason: 'account-disabled' };

/** Why a reset was refused; the management API words it. */
export class PasswordResetRefusedError extends Error {
  constructor(readonly refusal: PasswordResetRefusal) {
    super(`Password reset refused: ${refusal.reason}`);
  }
}
