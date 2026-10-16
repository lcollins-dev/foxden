import {
  CheckPasswordResetResponseDto,
  type CheckPasswordResetRequestDto,
  type ResetPasswordRequestDto,
  ResetPasswordResponseDto,
} from '@libs/dto';
import { createPasswordCredentials } from '@libs/fxa-crypto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

export const usePasswordResetService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();
  const notificationStore = useNotificationStore();

  function checkPasswordReset(token: string): Promise<CheckPasswordResetResponseDto> {
    const request: CheckPasswordResetRequestDto = { token };

    return apiService.makeRequest('password-reset/check', RequestType.POST, {
      response: CheckPasswordResetResponseDto,
      body: request,
    });
  }

  /** Answers the new session's token seed; the reset ends every other session of the account. */
  async function resetPassword(token: string, password: string): Promise<string> {
    const request: ResetPasswordRequestDto = { token, ...(await createPasswordCredentials(password)) };

    const response = await apiService
      .makeRequest('password-reset', RequestType.POST, { response: ResetPasswordResponseDto, body: request })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    return response.sessionToken;
  }

  return { checkPasswordReset, resetPassword };
};
