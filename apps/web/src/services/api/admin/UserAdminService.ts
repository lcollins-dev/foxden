import {
  CreatePasswordResetResponseDto,
  type UpdateStateRequestDto,
  type UpdateUserRequestDto,
  type UserListRequestDto,
  UserDto,
  UserListResponseDto,
  UserStatsResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useUserAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getUserList(
    userListRequest: UserListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<UserListResponseDto> {
    const userList = await apiService
      .makeRequest(`admin/user/list?page=${page}`, RequestType.PATCH, {
        response: UserListResponseDto,
        token: userStore.token,
        body: userListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return userList;
  }

  async function getUserStats(): Promise<UserStatsResponseDto> {
    const stats = await apiService
      .makeRequest('admin/user/stats', RequestType.GET, {
        response: UserStatsResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return stats;
  }

  async function getUser(userId: number, form: string | null = null): Promise<UserDto> {
    const user = await apiService
      .makeRequest(`admin/user/${userId}`, RequestType.GET, {
        response: UserDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return user;
  }

  async function updateUser(
    updateUserRequest: UpdateUserRequestDto,
    userId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updateUserRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  async function updateState(
    updateStateRequest: UpdateStateRequestDto,
    userId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  async function deleteUser(userId: number): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}`, RequestType.DELETE, {
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();
  }

  async function createPasswordReset(userId: number): Promise<CreatePasswordResetResponseDto> {
    const created = await apiService
      .makeRequest(`admin/user/${userId}/password-reset`, RequestType.POST, {
        response: CreatePasswordResetResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    return created;
  }

  return {
    getUserList,
    getUserStats,
    getUser,
    updateUser,
    updateState,
    deleteUser,
    createPasswordReset,
  };
};
