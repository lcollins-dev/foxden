import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

import { TokenserverError, tokenserverErrorFor, tokenserverErrors } from './tokenserver-error';
import { TokenserverRefusedError } from '@/core/tokenserver/tokenserver-refusal';

const RETRY_AFTER_SECONDS = 60;

/** Firefox treats a tokenserver error that is not JSON as a network failure, so every error here is JSON. */
@Catch()
export class TokenserverExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TokenserverExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = this.toTokenserverError(exception);

    if (error.httpStatus === 503) {
      response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    }

    response.status(error.httpStatus).json(error.body);
  }

  private toTokenserverError(exception: unknown): TokenserverError {
    if (exception instanceof TokenserverError) {
      return exception;
    }

    if (exception instanceof TokenserverRefusedError) {
      return tokenserverErrorFor(exception.refusal);
    }

    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.SERVICE_UNAVAILABLE) {
      return tokenserverErrors.unavailable();
    }

    this.logger.error({ error: exception }, 'catch(): Unexpected tokenserver error');

    return tokenserverErrors.internal();
  }
}
