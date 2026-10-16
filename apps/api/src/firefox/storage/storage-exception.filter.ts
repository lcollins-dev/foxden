import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

import { StorageError, storageErrorFor, storageErrors } from './storage-error';
import { sendStorageResponse, storageResponse } from './storage-response';
import { StorageRefusedError } from '@/core/storage/storage-refusal';
import { floorTimestamp } from '@/core/storage/storage-timestamp';

/** `null` for an unexpected failure, which is logged and answered with a 500. */
export function toStorageError(exception: unknown): StorageError | null {
  if (exception instanceof StorageError) {
    return exception;
  }

  if (exception instanceof StorageRefusedError) {
    return storageErrorFor(exception.refusal);
  }

  if (!(exception instanceof HttpException)) {
    return null;
  }

  switch (exception.getStatus()) {
    case HttpStatus.SERVICE_UNAVAILABLE:
      return storageErrors.unavailable();
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return storageErrors.bodyTooLarge();
    case HttpStatus.NOT_FOUND:
      return storageErrors.notFound();
    default:
      return exception.getStatus() < 500 ? new StorageError(exception.getStatus()) : null;
  }
}

export function sendStorageError(res: Response, error: StorageError): void {
  sendStorageResponse(
    res,
    storageResponse(error.httpStatus, String(error.weaveCode), floorTimestamp(Date.now()), {
      retryAfterSeconds: error.retryAfterSeconds,
    })
  );
}

/** Storage errors are a bare JSON WEAVE code with `X-Weave-Timestamp`, never Nest's error object. */
@Catch()
export class StorageExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(StorageExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let error = toStorageError(exception);

    if (error === null) {
      this.logger.error({ error: exception }, 'catch(): Unexpected storage error');
      error = storageErrors.internal();
    }

    sendStorageError(res, error);
  }
}
