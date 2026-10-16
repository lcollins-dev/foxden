import { z } from 'zod';

import { HEX_16_BYTES, URL_SAFE_BASE_64 } from '@/firefox/fxa/patterns';
import { fxaRequest, maxLength, numberString } from '@/firefox/fxa/request-fields';

/** fxa-auth-server/lib/devices.js SCHEMA, as `POST /account/device` validates it. */
export const DeviceDto = fxaRequest({
  id: z.string().regex(HEX_16_BYTES).optional(),
  name: maxLength(255).optional(),
  type: maxLength(16).optional(),
  pushCallback: maxLength(255)
    .regex(/^(https:\/\/\S+)?$/)
    .optional(),
  pushPublicKey: maxLength(88).regex(URL_SAFE_BASE_64).optional(),
  pushAuthKey: maxLength(24).regex(URL_SAFE_BASE_64).optional(),
  availableCommands: z.record(z.string(), z.unknown()).optional(),
  /** Some desktop versions send an empty array; accepted and ignored. */
  capabilities: z.array(z.unknown()).max(0).optional(),
});
export type DeviceDto = z.infer<typeof DeviceDto>;

export const DeviceDestroyDto = fxaRequest({
  id: z.string().regex(HEX_16_BYTES),
});
export type DeviceDestroyDto = z.infer<typeof DeviceDestroyDto>;

/** The query both device lists take (fxa-auth-server/lib/routes/devices-and-sessions.js, attached-clients.js). */
export const DeviceListQueryDto = fxaRequest({
  /** Milliseconds, still a string. */
  filterIdleDevicesTimestamp: numberString().optional(),
});
export type DeviceListQueryDto = z.infer<typeof DeviceListQueryDto>;
