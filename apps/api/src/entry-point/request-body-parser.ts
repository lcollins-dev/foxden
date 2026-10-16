import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { IncomingMessage } from 'node:http';

import { STORAGE_PATH_PREFIX } from '@libs/dto';

import { ConfigService } from '@/config/config.service';

import { STORAGE_LIMITS } from '@/core/storage/storage-limits';
import { storageBodyError } from '@/firefox/storage/storage-error';
import { sendStorageError } from '@/firefox/storage/storage-exception.filter';

const isStorageRequest = (request: IncomingMessage): boolean =>
  (request.url ?? '').startsWith(`${STORAGE_PATH_PREFIX}/`);

/** A storage body the raw parser refused is answered with a WEAVE code; every other refusal reaches Nest's filters. */
function storageBodyErrorHandler(error: unknown, request: Request, res: Response, next: NextFunction): void {
  if (!isStorageRequest(request)) {
    next(error);
    return;
  }

  sendStorageError(res, storageBodyError(error));
}

/**
 * Storage bodies are read raw, whatever their content type, since Firefox labels its JSON `text/plain`; the storage
 * routes parse them. The raw parser runs first, so the JSON parser finds a storage body consumed and leaves it alone.
 */
export function useRequestBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('raw', { type: isStorageRequest, limit: STORAGE_LIMITS.max_request_bytes });
  app.use(storageBodyErrorHandler);
  app.useBodyParser('json', { limit: app.get(ConfigService).requestMaxSizeJson });
}
