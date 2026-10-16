import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerInfoResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';
import { useServerService } from './ServerService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const SERVER_INFO = { publicUrl: 'https://sync.example.com', inviteLifetimeMs: 604800000 };

describe('useServerService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    makeRequestMock = vi.fn();

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: (error: unknown) => {
        throw error;
      },
    } as unknown as ReturnType<typeof useErrorService>);
  });

  // The answer is cached for the page's lifetime, so one test walks the whole sequence.
  it('asks again after a failure, then shares the answer', async () => {
    makeRequestMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(SERVER_INFO);

    await expect(useServerService().getServerInfo()).rejects.toThrow('offline');
    await expect(useServerService().getServerInfo()).resolves.toEqual(SERVER_INFO);
    await expect(useServerService().getServerInfo()).resolves.toEqual(SERVER_INFO);

    expect(makeRequestMock).toHaveBeenCalledTimes(2);
    expect(makeRequestMock).toHaveBeenCalledWith('server', RequestType.GET, { response: ServerInfoResponseDto });
  });
});
