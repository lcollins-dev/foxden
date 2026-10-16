import { z } from 'zod';

import { CLIENT_SALT } from '@libs/dto';

import { HEX_32_BYTES } from '@/firefox/fxa/patterns';
import { emailAddress, fxaRequest } from '@/firefox/fxa/request-fields';

/** fxa-auth-server/lib/routes/password.ts `/password/change/start`; `oldAuthPW` is the v2 authPW here. */
export const PasswordChangeStartDto = fxaRequest({
  email: emailAddress(),
  oldAuthPW: z.string().regex(HEX_32_BYTES),
});
export type PasswordChangeStartDto = z.infer<typeof PasswordChangeStartDto>;

/**
 * fxa-auth-server/lib/routes/password.ts `/password/change/finish` with only the v2 credentials required; `authPW`
 * and `wrapKb` (v1) are accepted and ignored, as at sign-up.
 */
export const PasswordChangeFinishDto = fxaRequest({
  authPWVersion2: z.string().regex(HEX_32_BYTES),
  wrapKbVersion2: z.string().regex(HEX_32_BYTES),
  clientSalt: z.string().regex(CLIENT_SALT),
  /** The id of the calling session, not its seed. */
  sessionToken: z.string().regex(HEX_32_BYTES),
  authPW: z.string().regex(HEX_32_BYTES).optional(),
  wrapKb: z.string().regex(HEX_32_BYTES).optional(),
});
export type PasswordChangeFinishDto = z.infer<typeof PasswordChangeFinishDto>;
