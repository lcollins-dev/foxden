import { ArgumentsHost, BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';
import { fxaErrors } from '@/firefox/fxa/fxa-error';
import { FxaExceptionFilter } from '@/firefox/fxa/fxa-exception.filter';

describe('FxaExceptionFilter', () => {
  let status: ReturnType<typeof vi.fn>;
  let json: ReturnType<typeof vi.fn>;
  let setHeader: ReturnType<typeof vi.fn>;
  let host: ArgumentsHost;

  beforeEach(() => {
    json = vi.fn();
    status = vi.fn(() => ({ json }));
    setHeader = vi.fn();
    host = { switchToHttp: () => ({ getResponse: () => ({ status, setHeader }) }) } as unknown as ArgumentsHost;
  });

  const render = (exception: unknown): { code: number; body: Record<string, unknown> } => {
    new FxaExceptionFilter().catch(exception, host);

    return {
      code: status.mock.calls[0][0] as number,
      body: json.mock.calls[0][0] as Record<string, unknown>,
    };
  };

  it('renders an FxaError as Mozilla`s body with its status', () => {
    expect(render(fxaErrors.invalidToken())).toEqual({
      code: 401,
      body: expect.objectContaining({ code: 401, errno: 110, error: 'Unauthorized' }) as unknown,
    });
  });

  it('maps any other bad request to errno 107', () => {
    expect(render(new BadRequestException('bad')).body).toMatchObject({ errno: 107 });
  });

  it('maps the throttler`s 429 to errno 114 with its wait in seconds, in the body and Retry-After', () => {
    expect(render(new TooManyRequestsException(42)).body).toMatchObject({ code: 429, errno: 114, retryAfter: 42 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('gives any other 429 Mozilla`s default wait of 30 seconds', () => {
    expect(render(new HttpException('Too Many Requests', 429)).body).toMatchObject({ errno: 114, retryAfter: 30 });
  });

  it('sends no Retry-After with other errors', () => {
    render(new NotFoundException());

    expect(setHeader).not.toHaveBeenCalled();
  });

  it('keeps the status of other client errors', () => {
    expect(render(new NotFoundException()).body).toMatchObject({ code: 404, errno: 999 });
  });

  it('hides an unexpected error behind errno 999', () => {
    expect(render(new Error('boom'))).toEqual({
      code: 500,
      body: expect.objectContaining({ code: 500, errno: 999, message: 'Unspecified error' }) as unknown,
    });
  });
});
