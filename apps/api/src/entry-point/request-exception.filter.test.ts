import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ExtendedBaseExceptionFilter } from '@/common/interceptors/ExtendedBaseExceptionFilter';

import { RequestExceptionFilter } from './request-exception.filter';
import { requestSurface } from './request-surface';
import { FxaExceptionFilter } from '@/firefox/fxa/fxa-exception.filter';
import { StorageExceptionFilter } from '@/firefox/storage/storage-exception.filter';
import { TokenserverExceptionFilter } from '@/firefox/tokenserver/tokenserver-exception.filter';

const hostFor = (path: string, routed = true): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ path, surface: routed ? requestSurface(path) : undefined }),
      getResponse: () => ({}),
    }),
  }) as unknown as ArgumentsHost;

describe('RequestExceptionFilter', () => {
  let accountsCatch: MockInstance;
  let tokenserverCatch: MockInstance;
  let storageCatch: MockInstance;
  let baseCatch: MockInstance;
  let filter: RequestExceptionFilter;

  beforeEach(() => {
    accountsCatch = vi.spyOn(FxaExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
    tokenserverCatch = vi.spyOn(TokenserverExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
    storageCatch = vi.spyOn(StorageExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
    baseCatch = vi.spyOn(ExtendedBaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
    filter = new RequestExceptionFilter({} as AbstractHttpAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['/auth/v1/account/login', 'accounts'],
    ['/oauth/v1/token', 'accounts'],
    ['/profile/v1/profile', 'accounts'],
    ['/.well-known/openid-configuration', 'accounts'],
    ['/token/1.0/sync/1.5', 'tokenserver'],
    ['/storage/1.5/1/info/collections', 'storage'],
  ])('answers a failure on %s in the %s format, validation failures included', (path, surface) => {
    const surfaceCatch: Record<string, MockInstance> = {
      accounts: accountsCatch,
      tokenserver: tokenserverCatch,
      storage: storageCatch,
    };

    filter.catch(new BadRequestException(), hostFor(path));

    expect(surfaceCatch[surface]).toHaveBeenCalledTimes(1);
    expect(baseCatch).not.toHaveBeenCalled();
  });

  it('hands every management API failure, validation failures included, to the base filter', () => {
    filter.catch(new BadRequestException(), hostFor('/api/v1/user/profile'));
    filter.catch(new NotFoundException(), hostFor('/api/v1/user/profile'));

    expect(baseCatch).toHaveBeenCalledTimes(2);
  });

  it('answers a request no route took, so no guard stamped, in our own format whatever its prefix', () => {
    filter.catch(new NotFoundException(), hostFor('/auth/v1/nothing-here', false));
    filter.catch(new BadRequestException(), hostFor('/storage/1.5/1/storage/c', false));

    expect(baseCatch).toHaveBeenCalledTimes(2);
    expect(accountsCatch).not.toHaveBeenCalled();
    expect(storageCatch).not.toHaveBeenCalled();
  });
});
