import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateInviteResponseDto, InviteListResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { useInviteAdminService } from './InviteAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'fxs_admin' };

describe('useInviteAdminService', () => {
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
      clearValidationError: vi.fn(),
    } as unknown as ReturnType<typeof useErrorService>);

    useUserStore().setToken('fxs_admin');
  });

  it('reads the pending invites', async () => {
    makeRequestMock.mockResolvedValue({ inviteList: [], emailConfigured: true });

    await expect(useInviteAdminService().getInviteList()).resolves.toEqual({ inviteList: [], emailConfigured: true });

    expect(makeRequestMock).toHaveBeenCalledWith('admin/invite/list', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: InviteListResponseDto,
    });
  });

  it('posts a new invite', async () => {
    const response = { link: 'https://sync.test/invite/abc', expiresAt: '2026-10-07T00:00:00.000Z', emailSent: true };
    makeRequestMock.mockResolvedValue(response);

    await expect(
      useInviteAdminService().createInvite({ email: 'casey@example.com', name: 'Casey Lee', admin: true })
    ).resolves.toEqual(response);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/invite', RequestType.POST, {
      ...TOKEN_OPTIONS,
      response: CreateInviteResponseDto,
      body: { email: 'casey@example.com', name: 'Casey Lee', admin: true },
    });
  });

  it('hands a refused invite to the error service', async () => {
    const refusal = new Error('This email already has a pending invite.');
    makeRequestMock.mockRejectedValue(refusal);

    await expect(
      useInviteAdminService().createInvite({ email: 'casey@example.com', name: 'Casey Lee', admin: false })
    ).rejects.toThrow(refusal);

    expect(handleErrorMock).toHaveBeenCalledWith(refusal);
  });

  it('revokes an invite by id and clears the toasts', async () => {
    useNotificationStore().addToast('Copied', 'The link is on your clipboard.');

    await useInviteAdminService().revokeInvite(7);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/invite/7', RequestType.DELETE, TOKEN_OPTIONS);
    expect(useNotificationStore().notifications).toEqual([]);
  });
});
