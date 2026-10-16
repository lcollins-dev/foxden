import { z } from 'zod';

import { HEX_32_BYTES } from '@/firefox/fxa/patterns';
import { emailAddress, fxaRequest, maxLength } from '@/firefox/fxa/request-fields';

export const AccountLoginDto = fxaRequest({
  email: emailAddress(),
  /** hex(authPW) from v2 stretching. */
  authPW: z.string().regex(HEX_32_BYTES),
  service: maxLength(16).optional(),
  reason: maxLength(16).optional(),
});
export type AccountLoginDto = z.infer<typeof AccountLoginDto>;
