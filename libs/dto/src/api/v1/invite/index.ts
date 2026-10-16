import { z } from 'zod';

import { emailAddress, flag, hexKey, requestBody, text } from '../../../fields';

export const CreateInviteRequestDto = requestBody({
  email: emailAddress(),
  /** The display name of the account created from the invite. */
  name: text(2, 256),
  /** Grants both admin roles to the account created from the invite. */
  admin: flag(),
});
export type CreateInviteRequestDto = z.infer<typeof CreateInviteRequestDto>;

export const CreateInviteResponseDto = z.object({
  /** `<public url>/invite/<token>`; the token is shown only here. */
  link: z.string(),
  /** ISO timestamp. */
  expiresAt: z.string(),
  /** False when SMTP is not configured or the send failed; the link still works. */
  emailSent: z.boolean(),
});
export type CreateInviteResponseDto = z.infer<typeof CreateInviteResponseDto>;

export const CheckInviteRequestDto = requestBody({
  token: hexKey('Invalid invite'),
});
export type CheckInviteRequestDto = z.infer<typeof CheckInviteRequestDto>;

export enum InviteState {
  VALID = 'valid',
  /** No invite has this token, or it was revoked or purged. */
  INVALID = 'invalid',
  EXPIRED = 'expired',
  /** An account was already created with it. */
  USED = 'used',
}

export const CheckedInviteDto = z.object({
  /** The address the account must be created with. */
  email: z.string(),
  admin: z.boolean(),
  /** ISO timestamp. */
  expiresAt: z.string(),
});
export type CheckedInviteDto = z.infer<typeof CheckedInviteDto>;

export const CheckInviteResponseDto = z.object({
  state: z.enum(InviteState),
  /** Set only while the invite is valid. */
  invite: CheckedInviteDto.nullable(),
});
export type CheckInviteResponseDto = z.infer<typeof CheckInviteResponseDto>;

/** An invite that is neither used nor expired. The token is not stored, so there is no link to show again. */
export const PendingInviteDto = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  admin: z.boolean(),
  /** ISO timestamp. */
  createdAt: z.string(),
  /** ISO timestamp. */
  expiresAt: z.string(),
});
export type PendingInviteDto = z.infer<typeof PendingInviteDto>;

export const InviteListResponseDto = z.object({
  /** Newest first. */
  inviteList: z.array(PendingInviteDto),
  /** Whether an SMTP host is set, so a new invite is emailed as well as shown. */
  emailConfigured: z.boolean(),
});
export type InviteListResponseDto = z.infer<typeof InviteListResponseDto>;
