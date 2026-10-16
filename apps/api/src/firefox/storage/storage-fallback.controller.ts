import { All, Controller, Req } from '@nestjs/common';
import { Request } from 'express';

import { storageErrors } from './storage-error';

/** Storage routes by path, relative to `/storage/1.5/<uid>`, with the methods each allows. */
const ROUTES: { pattern: RegExp; methods: string[] }[] = [
  { pattern: /^$/, methods: ['DELETE'] },
  { pattern: /^\/storage$/, methods: ['DELETE'] },
  { pattern: /^\/info\/(configuration|collections|collection_counts|collection_usage|quota)$/, methods: ['GET'] },
  { pattern: /^\/storage\/[^/]+$/, methods: ['GET', 'POST', 'DELETE'] },
  { pattern: /^\/storage\/[^/]+\/[^/]+$/, methods: ['GET', 'PUT', 'DELETE'] },
];

const STORAGE_USER_PREFIX = /^\/storage\/1\.5\/[0-9]{1,10}/;

/**
 * Answers what the storage controller does not match: a known path with the wrong method is a 405, anything else a
 * 404, both with a WEAVE body. Registered after the storage controller so its routes win.
 */
@Controller('storage/1.5')
export class StorageFallbackController {
  @All('{*path}')
  unmatched(@Req() request: Request): never {
    const path = request.originalUrl.split('?')[0];
    const userPrefix = STORAGE_USER_PREFIX.exec(path);

    if (userPrefix !== null) {
      const route = ROUTES.find(candidate => candidate.pattern.test(path.slice(userPrefix[0].length)));

      if (route !== undefined && !route.methods.includes(request.method)) {
        throw storageErrors.methodNotAllowed();
      }
    }

    throw storageErrors.notFound();
  }
}
