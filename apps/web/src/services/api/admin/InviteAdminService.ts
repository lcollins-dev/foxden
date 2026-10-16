import { CreateInviteResponseDto, type CreateInviteRequestDto, InviteListResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useInviteAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const notificationStore = useNotificationStore();
  const userStore = useUserStore();

  function getInviteList(): Promise<InviteListResponseDto> {
    return apiService
      .makeRequest('admin/invite/list', RequestType.GET, { response: InviteListResponseDto, token: userStore.token })
      .catch((error: unknown) => errorService.handleError(error));
  }

  async function createInvite(createInviteRequest: CreateInviteRequestDto): Promise<CreateInviteResponseDto> {
    const response = await apiService
      .makeRequest('admin/invite', RequestType.POST, {
        response: CreateInviteResponseDto,
        token: userStore.token,
        body: createInviteRequest,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    return response;
  }

  async function revokeInvite(inviteId: number): Promise<void> {
    await apiService
      .makeRequest(`admin/invite/${inviteId}`, RequestType.DELETE, { token: userStore.token })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  return { getInviteList, createInvite, revokeInvite };
};
