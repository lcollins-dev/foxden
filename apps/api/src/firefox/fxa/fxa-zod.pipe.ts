import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { FxaError, fxaErrors } from './fxa-error';

interface IRefusedField {
  key: string;
  missing: boolean;
}

/** Refuses a request with the errno Mozilla's auth server answers it with, since Firefox reads `errno`. */
@Injectable()
export class FxaZodPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.output<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<Schema> {
    // The issues carry the values sent, passwords included, so none of them leaves this method.
    const result = this.schema.safeParse(value, { reportInput: true });

    if (result.success) {
      return result.data;
    }

    const refused =
      metadata.data === undefined
        ? toRefusedFields(result.error.issues)
        : [{ key: metadata.data, missing: value === undefined }];

    throw toFxaError(refused);
  }
}

/** One entry per refused top-level field, the fields the schema does not name first. */
const toRefusedFields = (issues: z.core.$ZodIssue[]): IRefusedField[] => {
  const unnamed: IRefusedField[] = [];
  const named: IRefusedField[] = [];

  for (const issue of issues) {
    const [key] = issue.path;

    if (issue.code === 'unrecognized_keys' && issue.path.length === 0) {
      unnamed.push(...issue.keys.map(unnamedKey => ({ key: unnamedKey, missing: false })));
    } else if (typeof key === 'string') {
      named.push({ key, missing: issue.path.length === 1 && issue.input === undefined });
    }
  }

  return [...new Map([...unnamed, ...named].map(field => [field.key, field])).values()];
};

/** A missing field outranks an invalid one. */
const toFxaError = (refused: IRefusedField[]): FxaError => {
  const missing = refused.find(field => field.missing);

  if (missing !== undefined) {
    return fxaErrors.missingParameter(missing.key);
  }

  if (refused.length === 0) {
    return fxaErrors.invalidParameter();
  }

  return fxaErrors.invalidParameter({ keys: refused.map(field => field.key) });
};
