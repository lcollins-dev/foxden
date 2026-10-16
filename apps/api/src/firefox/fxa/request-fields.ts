import isEmail from 'validator/lib/isEmail';
import isLength from 'validator/lib/isLength';
import isNumeric from 'validator/lib/isNumeric';
import { z } from 'zod';

/** A body or query that refuses any field it does not name. An absent body reads as empty. */
export const fxaRequest = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.preprocess(value => value ?? {}, z.strictObject(shape));

/** Counts an astral character or an emoji presentation sequence as one character. */
export const maxLength = (max: number) => z.string().refine(value => isLength(value, { max }));

export const emailAddress = () => maxLength(255).refine(value => isEmail(value));

export const numberString = () => z.string().refine(value => isNumeric(value));

export const integer = () => z.number().refine(value => Number.isInteger(value));
