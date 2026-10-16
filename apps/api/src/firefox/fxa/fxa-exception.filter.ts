import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

import { FxaError, fxaErrors } from './fxa-error';
import { fxaErrorForRefusal } from './fxa-refusals';
import { TooManyRequestsException } from '@/common/exceptions/too-many-requests.exception';

// fxa/libs/accounts/errors/src/util.ts DEFAULT_RETRY_AFTER_MS
const DEFAULT_RETRY_AFTER_SECS = 30;

/** Renders every error on a Mozilla-protocol route in Mozilla's format, since Firefox reads `errno`. */
@Catch()
export class FxaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(FxaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const fxaError = this.toFxaError(exception);

    if (typeof fxaError.body.retryAfter === 'number') {
      response.setHeader('Retry-After', String(fxaError.body.retryAfter));
    }

    response.status(fxaError.getStatus()).json(fxaError.body);
  }

  private toFxaError(exception: unknown): FxaError {
    if (exception instanceof FxaError) {
      return exception;
    }

    const refused = fxaErrorForRefusal(exception);

    if (refused !== null) {
      return refused;
    }

    if (exception instanceof BadRequestException) {
      return fxaErrors.invalidParameter();
    }

    if (exception instanceof TooManyRequestsException) {
      return fxaErrors.throttled(exception.retryAfterSecs);
    }

    if (exception instanceof HttpException && exception.getStatus() === 429) {
      return fxaErrors.throttled(DEFAULT_RETRY_AFTER_SECS);
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return new FxaError(exception.getStatus(), 999, exception.message);
    }

    this.logger.error({ error: exception }, 'catch(): Unexpected error on an accounts route');

    return fxaErrors.unexpected();
  }
}
