import { z } from 'zod';

import { CLIENT_ID, HEX_32_BYTES, PKCE_CODE_VERIFIER } from '@/firefox/fxa/patterns';
import { fxaRequest, integer, maxLength } from '@/firefox/fxa/request-fields';

/** fxa-auth-server/lib/routes/oauth/token.js, for the grants Firefox uses. */
export const TokenDto = fxaRequest({
  grant_type: z.enum(['authorization_code', 'refresh_token', 'fxa-credentials']),
  client_id: z.string().regex(CLIENT_ID),
  code: z.string().regex(HEX_32_BYTES).optional(),
  code_verifier: z.string().regex(PKCE_CODE_VERIFIER).optional(),
  refresh_token: z.string().regex(HEX_32_BYTES).optional(),
  scope: maxLength(1024).optional(),
  ttl: integer().min(1).max(1209600).optional(),
  access_type: z.enum(['offline', 'online']).optional(),
  redirect_uri: maxLength(256).optional(),
});
export type TokenDto = z.infer<typeof TokenDto>;
