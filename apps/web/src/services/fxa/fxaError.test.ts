import { describe, expect, it } from 'vitest';

import { FXA_ERRNO, FxaClientError } from '@libs/fxa-crypto';

import { AppError, ValidationError } from '@/types/error';

import { toAppError } from './fxaError';

describe('toAppError', () => {
  it('turns a wrong password into a validation error on the password field', () => {
    expect(toAppError(new FxaClientError(400, FXA_ERRNO.INCORRECT_PASSWORD, 'Incorrect password'))).toEqual(
      new ValidationError(null, { password: { name: 'Password', message: "That password isn't right. Try again." } })
    );
  });

  it.each([FXA_ERRNO.ACCOUNT_EXISTS, FXA_ERRNO.UNKNOWN_ACCOUNT])(
    'turns errno %i into a validation error on the email field',
    errno => {
      const error = toAppError(new FxaClientError(400, errno, 'Refused'));

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields.email).toBeDefined();
    }
  );

  it('asks the admin to enable a disabled account', () => {
    expect(toAppError(new FxaClientError(400, FXA_ERRNO.ACCOUNT_DISABLED, 'Account disabled'))).toEqual(
      new AppError('This account is disabled. Ask your admin to enable it.')
    );
  });

  it('sends an account held to first-time setup to the web app', () => {
    const error = toAppError(new FxaClientError(400, FXA_ERRNO.SETUP_REQUIRED, 'Setup required'));

    expect(error.message).toMatch(/^Finish setting up this account in the web app first/);
  });

  it('words an unknown errno with the server message', () => {
    expect(toAppError(new FxaClientError(400, 999, 'Something odd'))).toEqual(
      new AppError('The server refused the request: Something odd')
    );
  });

  it('passes any other error through', () => {
    const error = new Error('unrelated');

    expect(toAppError(error)).toBe(error);
  });
});
