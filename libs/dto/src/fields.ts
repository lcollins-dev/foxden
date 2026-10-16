import { z } from 'zod';

// The web app shows each refusal under its field, so word it for the person filling the form.

export const lengthMessage = (min: number, max: number): string => {
  if (min === 0) {
    return `Enter no more than ${max} characters.`;
  }

  return `Enter between ${min} and ${max} characters.`;
};

export const rangeMessage = (min: number, max: number): string => `Enter a number from ${min} to ${max}.`;

export const WHOLE_NUMBER_MESSAGE = 'Enter a whole number.';
export const UNACCEPTED_FIELD_MESSAGE = "This field isn't accepted. Remove it and try again.";
export const NOT_AN_OBJECT_MESSAGE = 'Send the fields as a JSON object.';

const SELECTION_MESSAGE = 'Choose an option from the list.';

// The web app derives a key from the password, so only a broken client sends a malformed one.
const KEY_MESSAGE = 'Send the key as 64 lowercase hex characters.';

const EMAIL_MIN_LENGTH = 2;
const EMAIL_MAX_LENGTH = 255;

const KEY_PATTERN = /^[0-9a-f]{64}$/;

export const CLIENT_SALT = /^identity\.mozilla\.com\/picl\/v1\/quickStretchV2:[0-9a-f]{32}$/;

// Number() reads '', '4e1' and '0x2a' as numbers, so the whole string is matched first.
const INTEGER_PATTERN = /^-?\d+$/;

export const requestBody = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.strictObject(shape, {
    error: issue => (issue.code === 'unrecognized_keys' ? UNACCEPTED_FIELD_MESSAGE : NOT_AN_OBJECT_MESSAGE),
  });

export const text = (min: number, max: number) => {
  const error = lengthMessage(min, max);

  return z.string({ error }).min(min, { error }).max(max, { error });
};

export const emailAddress = () => {
  const error = 'Enter a valid email address.';

  return text(EMAIL_MIN_LENGTH, EMAIL_MAX_LENGTH).pipe(z.email({ error }));
};

/** 32 bytes as lowercase hex: a token from a link, or an authPW stretched from a password. */
export const hexKey = (error = KEY_MESSAGE) => z.string({ error }).regex(KEY_PATTERN, { error });

export const clientSalt = () => {
  const error = 'Send the salt the password was stretched with.';

  return z.string({ error }).regex(CLIENT_SALT, { error });
};

export const flag = () => z.boolean({ error: 'Choose yes or no.' });

export const wholeNumber = (min: number, max: number) => {
  const error = rangeMessage(min, max);

  return z.int({ error: WHOLE_NUMBER_MESSAGE }).min(min, { error }).max(max, { error });
};

export const wholeNumberParam = (min: number, max: number) =>
  z
    .string({ error: WHOLE_NUMBER_MESSAGE })
    .regex(INTEGER_PATTERN, { error: WHOLE_NUMBER_MESSAGE })
    .transform(Number)
    .pipe(wholeNumber(min, max));

export const enumValue = <Entity extends z.core.util.EnumLike>(entity: Entity) =>
  z.enum(entity, { error: SELECTION_MESSAGE });

export const enumList = <Entity extends z.core.util.EnumLike>(entity: Entity) =>
  z.array(enumValue(entity), { error: SELECTION_MESSAGE });

/** A response leaves JSON to encode the `Date` back to its ISO string. */
export const timestamp = () =>
  z.codec(z.iso.datetime({ offset: true, error: 'Enter a valid date and time.' }), z.date(), {
    decode: value => new Date(value),
    encode: date => date.toISOString(),
  });
