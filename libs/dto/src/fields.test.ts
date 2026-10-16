import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  clientSalt,
  emailAddress,
  enumList,
  enumValue,
  flag,
  hexKey,
  lengthMessage,
  requestBody,
  text,
  timestamp,
  wholeNumber,
  wholeNumberParam,
} from './fields';

const messagesFor = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map(issue => issue.message);
};

enum Colour {
  RED = 'red',
  BLUE = 'blue',
}

enum Role {
  ADMIN = 9100,
  EDITOR = 9200,
}

describe('requestBody', () => {
  const body = requestBody({ name: text(2, 256) });

  it('refuses a field the shape does not name', () => {
    expect(messagesFor(body, { name: 'Tester', extra: 1 })).toEqual([
      "This field isn't accepted. Remove it and try again.",
    ]);
  });

  it('asks for an object when the body is not one', () => {
    expect(messagesFor(body, 'name')).toEqual(['Send the fields as a JSON object.']);
  });

  it('leaves a field to word its own refusal', () => {
    expect(messagesFor(body, {})).toEqual(['Enter between 2 and 256 characters.']);
  });
});

describe('text', () => {
  it('accepts text within the limits', () => {
    expect(messagesFor(text(2, 256), 'Tester')).toEqual([]);
  });

  it('names both limits when the text is too short', () => {
    expect(messagesFor(text(2, 256), 'x')).toEqual(['Enter between 2 and 256 characters.']);
  });

  it('gives the same message for a value that is not text', () => {
    expect(messagesFor(text(2, 256), 42)).toEqual(['Enter between 2 and 256 characters.']);
  });

  it('names only the upper limit when the lower one is zero', () => {
    expect(messagesFor(text(0, 512), 'x'.repeat(513))).toEqual(['Enter no more than 512 characters.']);
  });
});

describe('lengthMessage', () => {
  it('names both limits', () => {
    expect(lengthMessage(2, 256)).toBe('Enter between 2 and 256 characters.');
  });

  it('names only the upper limit when the lower one is zero', () => {
    expect(lengthMessage(0, 32)).toBe('Enter no more than 32 characters.');
  });
});

describe('emailAddress', () => {
  it('accepts an email address', () => {
    expect(messagesFor(emailAddress(), 'tester@foxden.test')).toEqual([]);
  });

  it('asks for a valid address', () => {
    expect(messagesFor(emailAddress(), 'not-an-email')).toEqual(['Enter a valid email address.']);
  });

  it('names the length limits ahead of the address check', () => {
    expect(messagesFor(emailAddress(), `${'x'.repeat(250)}@foxden.test`)).toEqual([
      'Enter between 2 and 255 characters.',
    ]);
  });
});

describe('hexKey', () => {
  const key = 'a1'.repeat(32);

  it('accepts 32 bytes of lowercase hex', () => {
    expect(messagesFor(hexKey(), key)).toEqual([]);
  });

  it.each([key.toUpperCase(), key.slice(2), `${key}00`, undefined])('refuses %j', value => {
    expect(messagesFor(hexKey(), value)).toEqual(['Send the key as 64 lowercase hex characters.']);
  });

  it('words its refusal as the caller asks', () => {
    expect(messagesFor(hexKey('Invalid invite'), 'nope')).toEqual(['Invalid invite']);
  });
});

describe('clientSalt', () => {
  it('accepts a v2 salt', () => {
    expect(messagesFor(clientSalt(), `identity.mozilla.com/picl/v1/quickStretchV2:${'0f'.repeat(16)}`)).toEqual([]);
  });

  it.each(['identity.mozilla.com/picl/v1/quickStretchV2:', 'identity.mozilla.com/picl/v1/quickStretch:00', 42])(
    'refuses %j',
    value => {
      expect(messagesFor(clientSalt(), value)).toEqual(['Send the salt the password was stretched with.']);
    }
  );
});

describe('flag', () => {
  it('accepts a boolean', () => {
    expect(messagesFor(flag(), false)).toEqual([]);
  });

  it('asks for yes or no', () => {
    expect(messagesFor(flag(), 'true')).toEqual(['Choose yes or no.']);
  });
});

describe('wholeNumber', () => {
  it('accepts a whole number within the range', () => {
    expect(messagesFor(wholeNumber(1, 100), 42)).toEqual([]);
  });

  it('asks for a whole number', () => {
    expect(messagesFor(wholeNumber(1, 100), 4.2)).toEqual(['Enter a whole number.']);
  });

  it('names the range for a number outside it', () => {
    expect(messagesFor(wholeNumber(1, 100), 101)).toEqual(['Enter a number from 1 to 100.']);
  });
});

describe('wholeNumberParam', () => {
  const param = wholeNumberParam(1, 100);

  it('reads a numeric string as a number', () => {
    expect(param.parse('42')).toBe(42);
  });

  it('accepts both bounds', () => {
    expect(param.parse('1')).toBe(1);
    expect(param.parse('100')).toBe(100);
  });

  it('names the range for a value outside it', () => {
    expect(messagesFor(param, '0')).toEqual(['Enter a number from 1 to 100.']);
    expect(messagesFor(param, '101')).toEqual(['Enter a number from 1 to 100.']);
  });

  it('asks for a whole number when the value is missing', () => {
    expect(messagesFor(param, undefined)).toEqual(['Enter a whole number.']);
  });

  it.each(['', 'abc', '42.9', '42abc', ' 42', '42 ', '4e1', '0x2a'])('refuses %j as a whole number', value => {
    expect(messagesFor(param, value)).toEqual(['Enter a whole number.']);
  });

  it('refuses a negative value against a zero lower bound', () => {
    expect(messagesFor(wholeNumberParam(0, 10), '-1')).toEqual(['Enter a number from 0 to 10.']);
  });
});

describe('enumValue', () => {
  it('accepts a member of the enum', () => {
    expect(messagesFor(enumValue(Colour), 'red')).toEqual([]);
  });

  it('asks for an option from the list', () => {
    expect(messagesFor(enumValue(Colour), 'green')).toEqual(['Choose an option from the list.']);
  });
});

describe('enumList', () => {
  it('accepts a list of members', () => {
    expect(messagesFor(enumList(Role), [9100, 9200])).toEqual([]);
  });

  it('asks for an option from the list for a value outside the enum', () => {
    expect(messagesFor(enumList(Role), [9100, 1])).toEqual(['Choose an option from the list.']);
  });

  it('refuses the name of a numeric member', () => {
    expect(messagesFor(enumList(Role), ['ADMIN'])).toEqual(['Choose an option from the list.']);
  });

  it('asks for an option from the list when the value is not a list', () => {
    expect(messagesFor(enumList(Role), 9100)).toEqual(['Choose an option from the list.']);
  });
});

describe('timestamp', () => {
  it('reads what Date.toJSON writes back as the same moment', () => {
    const date = new Date('2026-05-15T12:00:00.000Z');

    expect(timestamp().parse(date.toJSON())).toEqual(date);
  });

  it('accepts a timestamp without seconds or fractions', () => {
    expect(timestamp().parse('2026-05-15T12:00Z')).toEqual(new Date('2026-05-15T12:00:00.000Z'));
  });

  it('accepts an offset other than UTC', () => {
    expect(timestamp().parse('2026-05-15T12:00:00+01:00')).toEqual(new Date('2026-05-15T11:00:00.000Z'));
  });

  it.each([
    '2026-05-15',
    '2026-05-15T12:00:00',
    'May 15, 2026',
    '2026-02-31T12:00:00Z',
    '2026-05-15T24:00:00Z',
    1747310400000,
  ])('refuses %j', value => {
    expect(messagesFor(timestamp(), value)).toEqual(['Enter a valid date and time.']);
  });
});
