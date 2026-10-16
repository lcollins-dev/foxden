import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';

import { ExtendedBaseExceptionFilter } from '@/common/interceptors/ExtendedBaseExceptionFilter';

import { ISurfacedRequest, RequestSurface } from './request-surface';
import { FxaExceptionFilter } from '@/firefox/fxa/fxa-exception.filter';
import { StorageExceptionFilter } from '@/firefox/storage/storage-exception.filter';
import { TokenserverExceptionFilter } from '@/firefox/tokenserver/tokenserver-exception.filter';

/**
 * The one global filter, answering in the error format of the surface a route belongs to: Mozilla's `errno` body on
 * the accounts servers, the tokenserver's `status`/`errors` body, a bare WEAVE code on storage, and our own JSON on
 * the management API. A request no route took - an unknown path, or a body the parser refused - gets our own JSON
 * whatever its prefix.
 */
@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
  private readonly accountsFilter = new FxaExceptionFilter();
  private readonly tokenserverFilter = new TokenserverExceptionFilter();
  private readonly storageFilter = new StorageExceptionFilter();
  private readonly baseFilter: ExtendedBaseExceptionFilter;

  constructor(httpAdapter: AbstractHttpAdapter) {
    this.baseFilter = new ExtendedBaseExceptionFilter(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { surface = RequestSurface.OTHER } = host.switchToHttp().getRequest<ISurfacedRequest>();

    switch (surface) {
      case RequestSurface.ACCOUNTS:
        this.accountsFilter.catch(exception, host);
        return;
      case RequestSurface.TOKENSERVER:
        this.tokenserverFilter.catch(exception, host);
        return;
      case RequestSurface.STORAGE:
        this.storageFilter.catch(exception, host);
        return;
      case RequestSurface.API:
      case RequestSurface.OTHER:
        this.baseFilter.catch(exception, host);
    }
  }
}
