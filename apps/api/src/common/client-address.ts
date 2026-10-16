import ipaddr from 'ipaddr.js';
import { isIP } from 'node:net';

/**
 * The address a request came from, with an IPv4-mapped IPv6 address as plain IPv4, or `null` for anything that is not
 * one. ipaddr.js refuses some zone ids Node accepts, such as a Docker bridge's.
 */
export function parseClientAddress(ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (isIP(ip) === 0) {
    return null;
  }

  try {
    return ipaddr.process(ip);
  } catch {
    return null;
  }
}

export function clientAddress(ip: string): string {
  return parseClientAddress(ip)?.toString() ?? ip;
}
