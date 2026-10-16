export type DeviceRefusal =
  | { reason: 'incomplete-push' }
  | { reason: 'invalid-available-commands' }
  | { reason: 'unknown-device' }
  | { reason: 'session-has-device'; deviceId: string };

export class DeviceRefusedError extends Error {
  constructor(readonly refusal: DeviceRefusal) {
    super(`Device refused: ${refusal.reason}`);
  }
}
