import { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestAuthGuard } from './request-auth.guard';
import { AuthGuard } from '@/api/v1/user/guards/auth.guard';

import { RequestSurface } from './request-surface';

const contextFor = (surface?: RequestSurface): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ path: '/', surface }) }) }) as unknown as ExecutionContext;

describe('RequestAuthGuard', () => {
  let authGuard: { canActivate: ReturnType<typeof vi.fn> };
  let requestAuthGuard: RequestAuthGuard;

  beforeEach(() => {
    authGuard = { canActivate: vi.fn().mockResolvedValue(true) };
    requestAuthGuard = new RequestAuthGuard(authGuard as unknown as AuthGuard);
  });

  it.each([RequestSurface.API, RequestSurface.OTHER, undefined])(
    'holds a request stamped %s to the session guard',
    async surface => {
      expect(await requestAuthGuard.canActivate(contextFor(surface))).toBe(true);
      expect(authGuard.canActivate).toHaveBeenCalled();
    }
  );

  it.each([RequestSurface.ACCOUNTS, RequestSurface.TOKENSERVER, RequestSurface.STORAGE])(
    'leaves a request stamped %s to the surface`s own token handling',
    async surface => {
      expect(await requestAuthGuard.canActivate(contextFor(surface))).toBe(true);
      expect(authGuard.canActivate).not.toHaveBeenCalled();
    }
  );

  it('carries a refusal from the session guard', async () => {
    authGuard.canActivate.mockRejectedValue(new Error('refused'));

    await expect(requestAuthGuard.canActivate(contextFor(RequestSurface.API))).rejects.toThrow('refused');
  });
});
