import { z } from 'zod';

import { emailAddress, fxaRequest } from '@/firefox/fxa/request-fields';

export const AccountEmailDto = fxaRequest({
  email: emailAddress(),
});
export type AccountEmailDto = z.infer<typeof AccountEmailDto>;
