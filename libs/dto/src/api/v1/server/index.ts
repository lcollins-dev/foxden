import { z } from 'zod';

export const ServerInfoResponseDto = z.object({
  /** The public origin, without a trailing slash: what `identity.fxaccounts.autoconfig.uri` must be set to. */
  publicUrl: z.string(),
  /** How long a new invite link works, in milliseconds. */
  inviteLifetimeMs: z.number(),
});
export type ServerInfoResponseDto = z.infer<typeof ServerInfoResponseDto>;
