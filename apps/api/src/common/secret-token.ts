import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 of a hex token, as stored in place of the token itself. */
export function hashToken(tokenHex: string): string {
  return createHash('sha256').update(Buffer.from(tokenHex, 'hex')).digest('hex');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
