const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

/** Decodes a hex string, throwing on odd length or a non-hex character. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error('Invalid hex string');
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

/** Encodes bytes as lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Encodes bytes as base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url, rejecting padding as Firefox does. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Invalid base64url string');
  }

  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));

  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function xorBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  if (left.length !== right.length) {
    throw new Error('XOR operands differ in length');
  }

  return Uint8Array.from(left, (byte, i) => byte ^ right[i]);
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}
