import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { RequestSurfaceGuard } from './request-surface.guard';

import { ISurfacedRequest, RequestSurface } from './request-surface';

describe('RequestSurfaceGuard', () => {
  it('stamps the surface of the path and lets the request through', () => {
    const request: ISurfacedRequest = { path: '/storage/1.5/1/info/collections' };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    expect(new RequestSurfaceGuard().canActivate(context)).toBe(true);
    expect(request.surface).toBe(RequestSurface.STORAGE);
  });
});
