import { describe, expect, it } from 'vitest';

import { newPasswordErrors } from './newPasswordError';

describe('newPasswordErrors', () => {
  it('accepts a long enough, repeated password that differs from the current one', () => {
    expect(newPasswordErrors('a new password', 'a new password', 'changeme')).toEqual({
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('asks for at least 8 characters', () => {
    expect(newPasswordErrors('short', 'short', 'changeme')).toEqual({
      newPassword: 'Use at least 8 characters.',
      confirmPassword: '',
    });
  });

  it('refuses the current password', () => {
    expect(newPasswordErrors('changeme', 'changeme', 'changeme')).toEqual({
      newPassword: 'Choose a password different from the current one.',
      confirmPassword: '',
    });
  });

  it('puts a mismatched repeat on the confirmation field', () => {
    expect(newPasswordErrors('a new password', 'a new passwort', 'changeme')).toEqual({
      newPassword: '',
      confirmPassword: "The passwords don't match.",
    });
  });
});
