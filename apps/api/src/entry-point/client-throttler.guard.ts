import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import ipaddr from 'ipaddr.js';

import { parseClientAddress } from '@/common/client-address';
import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';

/**
 * The client a request counts against: its IPv4 address, or its IPv6 /64, since a single host commonly holds a whole
 * /64 and could otherwise spread its requests over as many addresses as it likes.
 */
export function throttleTracker(ip: string): string {
  const address = parseClientAddress(ip);

  if (!(address instanceof ipaddr.IPv6)) {
    return address?.toString() ?? ip;
  }

  return `${new ipaddr.IPv6([...address.parts.slice(0, 4), 0, 0, 0, 0]).toString()}/64`;
}

@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(typeof req.ip === 'string' ? throttleTracker(req.ip) : '');
  }

  protected override throwThrottlingException(
    _context: ExecutionContext,
    { timeToBlockExpire }: ThrottlerLimitDetail
  ): Promise<void> {
    return Promise.reject(new TooManyRequestsException(timeToBlockExpire));
  }
}
