import { z } from 'zod';

import { fxaRequest, maxLength } from '@/firefox/fxa/request-fields';

export const VerifyDto = fxaRequest({
  token: maxLength(4096),
  token_type_hint: maxLength(32).optional(),
});
export type VerifyDto = z.infer<typeof VerifyDto>;
