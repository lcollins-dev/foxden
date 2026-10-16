import { ArgumentsHost, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { tokenserverErrors } from './tokenserver-error';
import { TokenserverExceptionFilter } from './tokenserver-exception.filter';
import { TokenserverRefusedError } from '@/core/tokenserver/tokenserver-refusal';

const render = (exception: unknown) => {
  const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  response.status.mockReturnValue(response);

  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;

  new TokenserverExceptionFilter().catch(exception, host);

  return response;
};

describe('TokenserverExceptionFilter', () => {
  it('renders a tokenserver error in syncstorage-rs shape', () => {
    const response = render(tokenserverErrors.invalidClientState('Unacceptable client-state value stale value'));

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      status: 'invalid-client-state',
      errors: [
        { location: 'header', name: 'X-Client-State', description: 'Unacceptable client-state value stale value' },
      ],
    });
  });

  it('renders a core refusal as the error syncstorage-rs answers it with', () => {
    const response = render(new TokenserverRefusedError({ reason: 'stale-client-state' }));

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      status: 'invalid-client-state',
      errors: [
        { location: 'header', name: 'X-Client-State', description: 'Unacceptable client-state value stale value' },
      ],
    });
  });

  it('asks Firefox to retry later on 503', () => {
    const response = render(new ServiceUnavailableException());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(response.json).toHaveBeenCalledWith({
      status: 'error',
      errors: [{ location: 'body', name: '', description: 'Resource is not available' }],
    });
  });

  it('renders anything unexpected as a JSON internal error', () => {
    for (const exception of [new Error('boom'), new BadRequestException()]) {
      const response = render(exception);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        status: 'internal-error',
        errors: [{ location: 'internal', name: '', description: 'Server error' }],
      });
    }
  });
});
