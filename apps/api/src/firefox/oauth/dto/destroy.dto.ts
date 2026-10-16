import { z } from 'zod';

import { CLIENT_ID } from '@/firefox/fxa/patterns';
import { fxaRequest, maxLength } from '@/firefox/fxa/request-fields';

/** fxa-auth-server/lib/routes/oauth/destroy.js; Firefox sends `{client_id, token}` or no token at all. */
export const DestroyDto = fxaRequest({
  client_id: z.string().regex(CLIENT_ID).optional(),
  token: maxLength(4096).optional(),
  access_token: maxLength(4096).optional(),
  refresh_token: maxLength(4096).optional(),
  token_type_hint: maxLength(32).optional(),
});
export type DestroyDto = z.infer<typeof DestroyDto>;
