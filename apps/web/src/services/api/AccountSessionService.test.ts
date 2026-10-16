import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionListResponseDto, SignOutOthersResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useAccountSessionService } from './AccountSessionService';
import { useApiService } from './ApiService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'fxs_me' };

describe('useAccountSessionService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue(undefined);
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);

    useUserStore().setToken('fxs_me');
  });

  it('lists the sessions of the signed-in account', async () => {
    makeRequestMock.mockResolvedValue({ sessionList: [] });

    await expect(useAccountSessionService().getSessionList()).resolves.toEqual({ sessionList: [] });

    expect(makeRequestMock).toHaveBeenCalledWith('user/session/list', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: SessionListResponseDto,
    });
  });

  it('signs out one session by id', async () => {
    await useAccountSessionService().signOutSession(12);

    expect(makeRequestMock).toHaveBeenCalledWith('user/session/12', RequestType.DELETE, TOKEN_OPTIONS);
  });

  it('signs out every other session and reports how many', async () => {
    makeRequestMock.mockResolvedValue({ signedOut: 3 });

    await expect(useAccountSessionService().signOutOthers()).resolves.toEqual({ signedOut: 3 });

    expect(makeRequestMock).toHaveBeenCalledWith('user/session/sign-out-others', RequestType.POST, {
      ...TOKEN_OPTIONS,
      response: SignOutOthersResponseDto,
    });
  });

  it('hands a failure to the error service', async () => {
    makeRequestMock.mockRejectedValue(new Error('offline'));

    await expect(useAccountSessionService().signOutSession(12)).rejects.toThrow('offline');

    expect(handleErrorMock).toHaveBeenCalled();
  });
});
