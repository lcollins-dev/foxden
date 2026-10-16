import { Request } from 'express';

const LANGUAGE_TAG = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;

/** The first language of Accept-Language, which Mozilla stores as the account locale. */
export function readLocale(request: Request): string | null {
  const first = request.headers['accept-language']?.split(',')[0]?.split(';')[0]?.trim() ?? '';

  return LANGUAGE_TAG.test(first) ? first : null;
}

export function readUserAgent(request: Request): string | null {
  const userAgent = request.headers['user-agent'];

  return userAgent === undefined ? null : userAgent.slice(0, 255);
}
