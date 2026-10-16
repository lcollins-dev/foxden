import { z } from 'zod';

import { emailAddress, hexKey, requestBody, text } from '../../../fields';
import { UserRoleId } from './role';

/** Created on start while no account holds the user-admin role. */
export const DEFAULT_ADMIN = {
  email: 'admin@example.com',
  password: 'changeme',
} as const;

export const ProfileResponseDto = z.object({
  uid: z.string(),
  name: z.string(),
  email: z.string(),
  userRoleIds: z.array(z.enum(UserRoleId)),
  /** While true, `/api/v1` refuses everything the first-time setup screen does not need. */
  mustChangePassword: z.boolean(),
});
export type ProfileResponseDto = z.infer<typeof ProfileResponseDto>;

export const UpdateProfileRequestDto = requestBody({
  name: text(2, 256),
});
export type UpdateProfileRequestDto = z.infer<typeof UpdateProfileRequestDto>;

export const ChangeEmailRequestDto = requestBody({
  email: emailAddress(),
  /** hex(authPW) of the current password from v2 stretching. */
  authPw: hexKey(),
});
export type ChangeEmailRequestDto = z.infer<typeof ChangeEmailRequestDto>;

export const AccountSessionDeviceDto = z.object({
  /** As Firefox registered it, for example "Sam's Firefox on MacBook Pro". */
  name: z.string(),
  /** Firefox's device type: `desktop`, `mobile`, `tablet`, `vr` or `tv`. */
  type: z.string(),
});
export type AccountSessionDeviceDto = z.infer<typeof AccountSessionDeviceDto>;

/**
 * A session of the signed-in account. A session with a device is a Firefox signed in to Sync; one without is a
 * sign-in to this web app.
 */
export const AccountSessionDto = z.object({
  id: z.number(),
  device: AccountSessionDeviceDto.nullable(),
  userAgent: z.string().nullable(),
  /** ISO timestamp. */
  createdAt: z.string(),
  /** ISO timestamp, updated at most once a minute. */
  lastAccessAt: z.string(),
  current: z.boolean(),
});
export type AccountSessionDto = z.infer<typeof AccountSessionDto>;

export const SessionListResponseDto = z.object({
  /** Newest first. */
  sessionList: z.array(AccountSessionDto),
});
export type SessionListResponseDto = z.infer<typeof SessionListResponseDto>;

export const SignOutOthersResponseDto = z.object({
  /** How many sessions were signed out. */
  signedOut: z.number(),
});
export type SignOutOthersResponseDto = z.infer<typeof SignOutOthersResponseDto>;

export * from './admin';
export * from './role';
