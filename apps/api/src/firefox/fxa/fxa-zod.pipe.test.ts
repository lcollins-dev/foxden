import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FxaZodPipe } from '@/firefox/fxa/fxa-zod.pipe';

import { FxaError } from '@/firefox/fxa/fxa-error';
import { fxaRequest } from '@/firefox/fxa/request-fields';

const BODY: ArgumentMetadata = { type: 'body' };
const QUERY: ArgumentMetadata = { type: 'query', data: 'uid' };

const bodyPipe = new FxaZodPipe(
  fxaRequest({
    email: z.string().min(2),
    authPW: z.string().min(2),
    service: z.string().max(8).optional(),
    scopes: z.array(z.literal('profile')).optional(),
  })
);

const refusalOf = (pipe: PipeTransform, value: unknown, metadata: ArgumentMetadata = BODY): Record<string, unknown> => {
  try {
    pipe.transform(value, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(FxaError);

    return (error as FxaError).body;
  }

  throw new Error('The pipe accepted the value');
};

describe('FxaZodPipe', () => {
  it('returns the parsed value', () => {
    expect(bodyPipe.transform({ email: 'tester@example.com', authPW: 'pw' }, BODY)).toEqual({
      email: 'tester@example.com',
      authPW: 'pw',
    });
  });

  it('answers a refused body with errno 107, the fields the schema does not name first, each once', () => {
    expect(refusalOf(bodyPipe, { email: 'x', authPW: 'pw', service: 'x'.repeat(9), extra: 1 })).toEqual(
      expect.objectContaining({
        code: 400,
        errno: 107,
        message: 'Invalid parameter in request body',
        validation: { keys: ['extra', 'email', 'service'] },
      })
    );
  });

  it('answers a field the body left out with errno 108, ahead of an invalid one', () => {
    expect(refusalOf(bodyPipe, { email: 'x' })).toMatchObject({
      errno: 108,
      message: 'Missing parameter in request body: authPW',
      param: 'authPW',
    });
  });

  it('treats a field sent as null as present but invalid', () => {
    expect(refusalOf(bodyPipe, { email: 'tester@example.com', authPW: null })).toMatchObject({
      errno: 107,
      validation: { keys: ['authPW'] },
    });
  });

  it('lands a refusal inside a list on the list', () => {
    expect(refusalOf(bodyPipe, { email: 'tester@example.com', authPW: 'pw', scopes: ['other'] })).toMatchObject({
      errno: 107,
      validation: { keys: ['scopes'] },
    });
  });

  it('answers a body that is not an object with errno 107 naming no field', () => {
    expect(refusalOf(bodyPipe, [])).toMatchObject({ errno: 107, validation: undefined });
  });

  it('names a refused query value after itself, as missing when absent', () => {
    const pipe = new FxaZodPipe(z.string().regex(/^[0-9a-f]{32}$/));

    expect(refusalOf(pipe, undefined, QUERY)).toMatchObject({ errno: 108, param: 'uid' });
    expect(refusalOf(pipe, 'nope', QUERY)).toMatchObject({ errno: 107, validation: { keys: ['uid'] } });
  });

  it('keeps the values sent out of the refusal', () => {
    expect(JSON.stringify(refusalOf(bodyPipe, { email: 'x', authPW: 'secret-value' }))).not.toContain('secret-value');
  });
});
