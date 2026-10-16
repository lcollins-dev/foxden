import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { storageBodyError, storageErrors } from './storage-error';
import { StorageExceptionFilter, toStorageError } from './storage-exception.filter';
import { StorageRefusedError } from '@/core/storage/storage-refusal';

describe('storage errors', () => {
  it.each([
    [storageErrors.invalidBso(), 400, 8],
    [storageErrors.bodyTooLarge(), 413, 17],
    [new ServiceUnavailableException(), 503, 0],
    [new PayloadTooLargeException(), 413, 17],
    [new NotFoundException(), 404, 0],
    [new BadRequestException(), 400, 0],
    [new StorageRefusedError({ reason: 'stale-uid' }), 401, 0],
    [new StorageRefusedError({ reason: 'not-found' }), 404, 0],
    [new StorageRefusedError({ reason: 'batch-closed' }), 400, 0],
    [new StorageRefusedError({ reason: 'batch-too-large' }), 400, 17],
  ])('maps %s to %i with WEAVE code %i', (exception, status, weaveCode) => {
    expect(toStorageError(exception)).toMatchObject({ httpStatus: status, weaveCode });
  });

  it('answers a refused body with 413 when it was too large and 400 otherwise', () => {
    expect(storageBodyError({ status: 413, type: 'entity.too.large' })).toMatchObject({
      httpStatus: 413,
      weaveCode: 17,
    });
    expect(storageBodyError(new SyntaxError('bad'))).toMatchObject({ httpStatus: 400, weaveCode: 0 });
  });

  it('leaves an unexpected failure unmapped', () => {
    expect(toStorageError(new Error('boom'))).toBeNull();
  });

  it('renders a bare WEAVE code with X-Weave-Timestamp and Retry-After on 503', () => {
    const res = { status: vi.fn(), setHeader: vi.fn(), send: vi.fn(), end: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;

    new StorageExceptionFilter().catch(new ServiceUnavailableException(), host);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('X-Weave-Timestamp', expect.stringMatching(/^[0-9]+\.[0-9]{2}$/));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalledWith('0');
  });

  it('renders an unexpected failure as 500', () => {
    const res = { status: vi.fn(), setHeader: vi.fn(), send: vi.fn(), end: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;

    new StorageExceptionFilter().catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('0');
  });
});
