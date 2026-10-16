import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { emailAddress, fxaRequest, integer, maxLength, numberString } from '@/firefox/fxa/request-fields';

describe('request fields', () => {
  it('reads an absent body as empty and refuses a field the schema does not name', () => {
    const schema = fxaRequest({ token: z.string().optional() });

    expect(schema.parse(undefined)).toEqual({});
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('counts an astral character or an emoji presentation sequence as one character', () => {
    expect(maxLength(2).safeParse('😀😀').success).toBe(true);
    expect(maxLength(2).safeParse('❤️❤️').success).toBe(true);
    expect(maxLength(2).safeParse('abc').success).toBe(false);
  });

  it('takes an address with a non-ASCII local part, up to 255 characters', () => {
    expect(emailAddress().safeParse('josé@example.com').success).toBe(true);
    expect(emailAddress().safeParse('not-an-email').success).toBe(false);
    expect(emailAddress().safeParse(null).success).toBe(false);
  });

  it('takes a decimal number string only', () => {
    expect(numberString().safeParse('1759230000123').success).toBe(true);
    expect(numberString().safeParse('-1.5').success).toBe(true);
    expect(numberString().safeParse('yesterday').success).toBe(false);
    expect(numberString().safeParse(1).success).toBe(false);
  });

  it('takes a whole number beyond the safe range, as Number.isInteger does', () => {
    expect(integer().safeParse(2 ** 60).success).toBe(true);
    expect(integer().safeParse(1.5).success).toBe(false);
    expect(integer().safeParse('1').success).toBe(false);
  });
});
