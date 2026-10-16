import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { FxaDeviceCredentialGuard } from '@/firefox/fxa/fxa-device-credential.guard';

import { OauthService } from '@/core/oauth/oauth.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('FxaDeviceCredentialGuard', () => {
  const resolved = { session: { id: 1 }, user: { id: 2 } } as unknown as IResolvedSession;
  const REFRESH_TOKEN = 'c'.repeat(64);

  const buildGuard = (sessionResolve: unknown, refreshResolve: unknown) => {
    const sessionService = { resolve: vi.fn().mockResolvedValue(sessionResolve), recordAccess: vi.fn() };
    const oauthService = { resolveRefreshTokenSession: vi.fn().mockResolvedValue(refreshResolve) };
    const guard = new FxaDeviceCredentialGuard(
      sessionService as unknown as SessionService,
      oauthService as unknown as OauthService
    );

    return { guard, sessionService, oauthService };
  };

  it('resolves a Bearer refresh token to its session and records the access', async () => {
    const { guard, sessionService, oauthService } = buildGuard(null, resolved);
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${REFRESH_TOKEN}` } };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(oauthService.resolveRefreshTokenSession).toHaveBeenCalledWith(REFRESH_TOKEN);
    expect(sessionService.resolve).not.toHaveBeenCalled();
    expect(sessionService.recordAccess).toHaveBeenCalledWith(resolved.session);
    expect(request.fxaSession).toBe(resolved);
  });

  it('takes a session token as FxaSessionGuard does', async () => {
    const { guard, sessionService, oauthService } = buildGuard(resolved, null);
    const request: Record<string, unknown> = { headers: { authorization: `Bearer fxs_${'d'.repeat(64)}` } };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(sessionService.resolve).toHaveBeenCalledWith(`Bearer fxs_${'d'.repeat(64)}`);
    expect(oauthService.resolveRefreshTokenSession).not.toHaveBeenCalled();
  });

  it('answers errno 110 for a session token or Hawk header that resolves to nothing, and for a malformed bearer', async () => {
    for (const authorization of [`Bearer fxs_${'d'.repeat(64)}`, `Hawk id="${'d'.repeat(64)}"`, 'Bearer xyz']) {
      const { guard, oauthService } = buildGuard(null, null);

      const rejection = guard.canActivate(buildContext({ headers: { authorization } }));

      await expect(rejection).rejects.toMatchObject({ body: { code: 401, errno: 110 } });
      expect(oauthService.resolveRefreshTokenSession).not.toHaveBeenCalled();
    }
  });

  it('answers errno 110 for a refresh token that resolves to nothing', async () => {
    const { guard } = buildGuard(null, null);

    const rejection = guard.canActivate(buildContext({ headers: { authorization: `Bearer ${REFRESH_TOKEN}` } }));

    await expect(rejection).rejects.toMatchObject({ body: { code: 401, errno: 110 } });
  });
});
