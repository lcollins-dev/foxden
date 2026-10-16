import { Catch, ArgumentsHost, BadRequestException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Response } from 'express';

import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';

@Catch()
export class ExtendedBaseExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    let reported = exception;

    if (exception instanceof TooManyRequestsException) {
      host.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(exception.retryAfterSecs));
    }

    if (exception instanceof URIError) {
      reported = new BadRequestException('Failed to decode URL param');
    } else if (this.isExceptionWithType(exception) && exception.type === 'entity.too.large') {
      reported = new BadRequestException('Request body is too large');
    }

    super.catch(reported, host);
  }

  isExceptionWithType(value: unknown): value is { type: string } {
    return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
  }
}
