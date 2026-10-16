import { FXA_ERRNO, FxaClientError } from '@libs/fxa-crypto';

import { AppError, ValidationError } from '@/types/error';

export const NO_ACCOUNT_MESSAGE = "There's no account for this email.";

const ERRNO_MESSAGES: Record<number, string> = {
  [FXA_ERRNO.ACCOUNT_EXISTS]: 'An account already exists for this email. Sign in instead.',
  [FXA_ERRNO.UNKNOWN_ACCOUNT]: NO_ACCOUNT_MESSAGE,
  [FXA_ERRNO.INCORRECT_PASSWORD]: "That password isn't right. Try again.",
  [FXA_ERRNO.INVALID_TOKEN]: 'Your session has ended. Sign in again.',
  [FXA_ERRNO.THROTTLED]: 'Too many attempts. Wait a few minutes and try again.',
  [FXA_ERRNO.INVALID_INVITE]: "This invite link doesn't work any more. Ask your admin for a new one.",
  [FXA_ERRNO.ACCOUNT_DISABLED]: 'This account is disabled. Ask your admin to enable it.',
  [FXA_ERRNO.SETUP_REQUIRED]:
    'Finish setting up this account in the web app first: sign in there and choose a new password, then sign in ' +
    'to Firefox again.',
};

// Mozilla's auth server answers every refusal as an errno, so the ones about one field are picked out here.
const FIELD_ERRNOS: Partial<Record<number, { path: string; name: string }>> = {
  [FXA_ERRNO.ACCOUNT_EXISTS]: { path: 'email', name: 'Email' },
  [FXA_ERRNO.UNKNOWN_ACCOUNT]: { path: 'email', name: 'Email' },
  [FXA_ERRNO.INCORRECT_PASSWORD]: { path: 'password', name: 'Password' },
};

/** A refusal about one field becomes a validation error for its `path`; any other becomes an app error. */
export const toAppError = (error: unknown): Error => {
  if (!(error instanceof FxaClientError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const message = ERRNO_MESSAGES[error.errno] ?? `The server refused the request: ${error.message}`;
  const field = FIELD_ERRNOS[error.errno];

  return field === undefined
    ? new AppError(message)
    : new ValidationError(null, { [field.path]: { name: field.name, message } });
};
