import { type ChangeEmailRequestDto, type UpdateProfileRequestDto, ProfileResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { apiTokenForSession, sessionTokenIdOf } from '@/utils/apiToken';

import { useLogService } from '@/services/LogService';
import { useFxaService } from '@/services/fxa/FxaService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

const logService = useLogService();
const logger = logService.createLogger('services/api/UserService');

export const useUserService = () => {
  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  const apiService = useApiService();
  const errorService = useErrorService();
  const fxaService = useFxaService();

  function signedInAccount(): { email: string; token: string } {
    if (userStore.profile === null || userStore.token === null) {
      throw new Error('Not signed in');
    }

    return { email: userStore.profile.email, token: userStore.token };
  }

  async function getProfile(): Promise<ProfileResponseDto> {
    const profileResponse = await apiService
      .makeRequest('user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    userStore.setProfile(profileResponse);

    return profileResponse;
  }

  async function updateProfile(
    updateProfileRequest: UpdateProfileRequestDto,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest('user/profile', RequestType.PATCH, {
        token: userStore.token,
        form,
        body: updateProfileRequest,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    await getProfile();
  }

  async function changeEmail(email: string, currentPassword: string): Promise<void> {
    const account = signedInAccount();
    const changeEmailRequest: ChangeEmailRequestDto = {
      email,
      authPw: await fxaService.authPw(account.email, currentPassword),
    };

    await apiService
      .makeRequest('user/email', RequestType.POST, {
        token: account.token,
        body: changeEmailRequest,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearAllNotifications();

    await getProfile();
  }

  /** The server ends every session of the account, so this signs the web app in with the new one it answers. */
  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const account = signedInAccount();

    const session = await fxaService.changePassword({
      email: account.email,
      oldPassword: currentPassword,
      newPassword,
      sessionTokenId: sessionTokenIdOf(account.token),
    });

    userStore.setToken(await apiTokenForSession(session.sessionToken));

    await getProfile();
  }

  async function logout(): Promise<void> {
    await apiService
      .makeRequest('user/logout', RequestType.POST, {
        token: userStore.token,
      })
      .finally(() => {
        userStore.clearAuth();
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'logout(): Failed to call logout endpoint');
      });

    notificationStore.clearAllNotifications();
  }

  return { getProfile, updateProfile, changeEmail, changePassword, logout };
};
