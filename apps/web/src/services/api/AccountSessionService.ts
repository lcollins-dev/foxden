import { SessionListResponseDto, SignOutOthersResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

export const useAccountSessionService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const notificationStore = useNotificationStore();
  const userStore = useUserStore();

  function getSessionList(): Promise<SessionListResponseDto> {
    return apiService
      .makeRequest('user/session/list', RequestType.GET, {
        response: SessionListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));
  }

  async function signOutSession(sessionId: number): Promise<void> {
    await apiService
      .makeRequest(`user/session/${sessionId}`, RequestType.DELETE, { token: userStore.token })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  async function signOutOthers(): Promise<SignOutOthersResponseDto> {
    const response = await apiService
      .makeRequest('user/session/sign-out-others', RequestType.POST, {
        response: SignOutOthersResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    return response;
  }

  return { getSessionList, signOutSession, signOutOthers };
};
