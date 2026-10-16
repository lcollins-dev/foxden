import { z } from 'zod';

import { CLIENT_ID } from '@/firefox/fxa/patterns';
import { fxaRequest, maxLength } from '@/firefox/fxa/request-fields';

export const ScopedKeyDataDto = fxaRequest({
  client_id: z.string().regex(CLIENT_ID),
  scope: maxLength(1024),
});
export type ScopedKeyDataDto = z.infer<typeof ScopedKeyDataDto>;
