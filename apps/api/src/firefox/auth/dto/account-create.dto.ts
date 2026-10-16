import { z } from 'zod';

import { CLIENT_SALT } from '@libs/dto';

import { HEX_32_BYTES } from '@/firefox/fxa/patterns';
import { emailAddress, fxaRequest, maxLength } from '@/firefox/fxa/request-fields';

/** Mozilla's create body with only the v2 credentials required; `authPW` and `wrapKb` (v1) are accepted and ignored. */
export const AccountCreateDto = fxaRequest({
  email: emailAddress(),
  authPWVersion2: z.string().regex(HEX_32_BYTES),
  wrapKbVersion2: z.string().regex(HEX_32_BYTES),
  clientSalt: z.string().regex(CLIENT_SALT),
  inviteToken: z.string().regex(HEX_32_BYTES),
  authPW: z.string().regex(HEX_32_BYTES).optional(),
  wrapKb: z.string().regex(HEX_32_BYTES).optional(),
  service: maxLength(16).optional(),
});
export type AccountCreateDto = z.infer<typeof AccountCreateDto>;
