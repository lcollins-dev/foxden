import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { FxaSessionGuard } from '@/firefox/fxa/fxa-session.guard';

import { IResolvedSession, SessionService } from '@/core/session/session.service';

import { FxaError } from '@/firefox/fxa/fxa-error';

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('FxaSessionGuard', () => {
  it('attaches the resolved session to the request', async () => {
    const resolved = { session: { id: 1 }, user: { id: 2 } } as unknown as IResolvedSession;
    const resolve = vi.fn().mockResolvedValue(resolved);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer fxs_x' } };

    const guard = new FxaSessionGuard({ resolve } as unknown as SessionService);

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('Bearer fxs_x');
    expect(request.fxaSession).toBe(resolved);
  });

  it('answers errno 110 when no live session matches, which sends Firefox to checkAccountStatus', async () => {
    const guard = new FxaSessionGuard({ resolve: vi.fn().mockResolvedValue(null) } as unknown as SessionService);

    const rejection = guard.canActivate(buildContext({ headers: {} }));

    await expect(rejection).rejects.toBeInstanceOf(FxaError);
    await expect(rejection).rejects.toMatchObject({ body: { code: 401, errno: 110 } });
  });
});
