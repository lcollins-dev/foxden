/** Mozilla's sign-up form asks for the same minimum. */
export const MIN_PASSWORD_LENGTH = 8;

export interface INewPasswordErrors {
  newPassword: string;
  confirmPassword: string;
}

/** Why a new password cannot be used, per field; `''` for a field that is fine. */
export const newPasswordErrors = (
  newPassword: string,
  confirmPassword: string,
  currentPassword: string
): INewPasswordErrors => {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { newPassword: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, confirmPassword: '' };
  }

  if (newPassword === currentPassword) {
    return { newPassword: 'Choose a password different from the current one.', confirmPassword: '' };
  }

  if (newPassword !== confirmPassword) {
    return { newPassword: '', confirmPassword: "The passwords don't match." };
  }

  return { newPassword: '', confirmPassword: '' };
};
