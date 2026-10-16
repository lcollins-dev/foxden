import { HttpException, HttpStatus } from '@nestjs/common';

/** Each surface's filter answers it with a `Retry-After` header. */
export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSecs: number) {
    super('Too many requests. Wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
