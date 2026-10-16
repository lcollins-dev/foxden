import { z } from 'zod';

import { clientSalt, hexKey, requestBody } from '../../../fields';

const INVALID_LINK_MESSAGE = 'Invalid password reset link';

export const CreatePasswordResetResponseDto = z.object({
  /** `<public url>/reset-password/<token>`; the token is shown only here. */
  link: z.string(),
  /** ISO timestamp. */
  expiresAt: z.string(),
});
export type CreatePasswordResetResponseDto = z.infer<typeof CreatePasswordResetResponseDto>;

export const CheckPasswordResetRequestDto = requestBody({
  token: hexKey(INVALID_LINK_MESSAGE),
});
export type CheckPasswordResetRequestDto = z.infer<typeof CheckPasswordResetRequestDto>;

export enum PasswordResetState {
  VALID = 'valid',
  /** No reset link has this token, or it was revoked, replaced or purged. */
  INVALID = 'invalid',
  EXPIRED = 'expired',
  /** The password was already reset with it. */
  USED = 'used',
}

export const CheckedPasswordResetDto = z.object({
  email: z.string(),
  /** ISO timestamp. */
  expiresAt: z.string(),
});
export type CheckedPasswordResetDto = z.infer<typeof CheckedPasswordResetDto>;

export const CheckPasswordResetResponseDto = z.object({
  state: z.enum(PasswordResetState),
  /** Set only while the link is valid. */
  passwordReset: CheckedPasswordResetDto.nullable(),
});
export type CheckPasswordResetResponseDto = z.infer<typeof CheckPasswordResetResponseDto>;

/** The new password's v2 credentials, stretched in the browser; the server makes a new kB. */
export const ResetPasswordRequestDto = requestBody({
  token: hexKey(INVALID_LINK_MESSAGE),
  authPw: hexKey(),
  clientSalt: clientSalt(),
});
export type ResetPasswordRequestDto = z.infer<typeof ResetPasswordRequestDto>;

export const ResetPasswordResponseDto = z.object({
  /** The new session's token seed as hex; the web app authenticates with its token id. */
  sessionToken: z.string(),
});
export type ResetPasswordResponseDto = z.infer<typeof ResetPasswordResponseDto>;
