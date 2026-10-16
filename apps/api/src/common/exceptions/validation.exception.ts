import { BadRequestException, HttpStatus } from '@nestjs/common';

import { ValidationResponseDto } from '@libs/dto';

import { toValidationErrors } from '@/common/pipes/zod.pipe';

/** Answers in `ZodPipe`'s refused-body shape, which the web app shows under the field at `path`. */
export class ValidationException extends BadRequestException {
  constructor(path: string, message: string) {
    const response: ValidationResponseDto = {
      statusCode: HttpStatus.BAD_REQUEST,
      message: toValidationErrors([{ code: 'custom', path: path.split('.'), message }]),
      error: 'Bad Request',
    };

    super(response);
  }
}
