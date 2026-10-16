import { z } from 'zod';

import { emailAddress, enumList, enumValue, flag, requestBody, text } from '../../../fields';
import { UserRoleId } from './role';

export enum UserListStatus {
  ALL = 'all',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

/** An admin holds either admin role; a user holds neither. */
export enum UserListRole {
  ALL = 'all',
  ADMIN = 'admin',
  USER = 'user',
}

export const ListUserDto = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  enabled: z.boolean(),
  userRoleIds: z.array(z.number()),
  /** ISO timestamp. */
  createdDate: z.string(),
  /** ISO timestamp of the latest sign-in or session use, or null when the account was never used. */
  lastActiveAt: z.string().nullable(),
});
export type ListUserDto = z.infer<typeof ListUserDto>;

export const UserDto = ListUserDto.extend({
  /** Matches `ProfileResponseDto.uid` for the same account. */
  uid: z.string(),
  lastLoginSuccess: z.string().nullable(),
  lastLoginFail: z.string().nullable(),
  /** ISO timestamp of the pending reset link's expiry. */
  passwordResetExpiresAt: z.string().nullable(),
});
export type UserDto = z.infer<typeof UserDto>;

export const UserListRequestDto = requestBody({
  /** An empty search matches everyone, as no search does. */
  search: text(0, 512)
    .transform(search => (search === '' ? undefined : search))
    .optional(),
  status: enumValue(UserListStatus),
  /** All roles when left out. */
  role: enumValue(UserListRole).optional(),
});
export type UserListRequestDto = z.infer<typeof UserListRequestDto>;

export const UserListResponseDto = z.object({
  userList: z.array(ListUserDto),
  pages: z.number(),
  /** How many accounts match the request, across every page. */
  total: z.number(),
});
export type UserListResponseDto = z.infer<typeof UserListResponseDto>;

export const UserStatsResponseDto = z.object({
  total: z.number(),
  enabled: z.number(),
  disabled: z.number(),
});
export type UserStatsResponseDto = z.infer<typeof UserStatsResponseDto>;

export const UpdateUserRequestDto = requestBody({
  name: text(2, 256),
  email: emailAddress(),
  userRoleIds: enumList(UserRoleId),
});
export type UpdateUserRequestDto = z.infer<typeof UpdateUserRequestDto>;

export const UpdateStateRequestDto = requestBody({
  enabled: flag(),
});
export type UpdateStateRequestDto = z.infer<typeof UpdateStateRequestDto>;
