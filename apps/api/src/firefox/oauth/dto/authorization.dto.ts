import { z } from 'zod';

import { CLIENT_ID, COMPACT_JWE, PKCE_CODE_CHALLENGE } from '@/firefox/fxa/patterns';
import { fxaRequest, integer, maxLength } from '@/firefox/fxa/request-fields';

/** fxa-auth-server/lib/routes/oauth/authorization.js, as our web UI sends it. */
export const AuthorizationDto = fxaRequest({
  client_id: z.string().regex(CLIENT_ID),
  state: maxLength(512),
  scope: maxLength(1024),
  response_type: z.string().optional(),
  access_type: z.enum(['offline', 'online']).optional(),
  code_challenge: z.string().regex(PKCE_CODE_CHALLENGE).optional(),
  code_challenge_method: z.enum(['S256']).optional(),
  keys_jwe: maxLength(1024).regex(COMPACT_JWE).optional(),
  redirect_uri: maxLength(256).optional(),
  service: maxLength(16).optional(),
  acr_values: maxLength(256).optional(),
  max_age: integer().min(0).optional(),
  prompt: maxLength(64).optional(),
});
export type AuthorizationDto = z.infer<typeof AuthorizationDto>;
