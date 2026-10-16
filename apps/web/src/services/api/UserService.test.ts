import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useFxaService } from '@/services/fxa/FxaService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';
import { useUserService } from './UserService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

vi.mock('@/services/fxa/FxaService', () => ({
  useFxaService: vi.fn(),
}));

vi.mock('@/utils/apiToken', () => ({
  apiTokenForSession: vi.fn((sessionToken: string) => Promise.resolve(`fxs_id-of-${sessionToken}`)),
  sessionTokenIdOf: vi.fn((apiToken: string) => apiToken.replace(/^fxs_/, '')),
}));

const PROFILE = {
  uid: '0123456789abcdef0123456789abcdef',
  name: 'Tester',
  email: 'tester@example.com',
  userRoleIds: [],
  mustChangePassword: false,
};

describe('useUserService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;
  let clearAllNotificationsMock: ReturnType<typeof vi.fn<() => void>>;
  let authPwMock: ReturnType<typeof vi.fn>;
  let changePasswordMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn();
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    clearValidationErrorMock = vi.fn();
    clearAllNotificationsMock = vi.fn<() => void>();

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: clearValidationErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);

    useNotificationStore().clearAllNotifications = clearAllNotificationsMock;

    authPwMock = vi.fn().mockResolvedValue('a'.repeat(64));
    changePasswordMock = vi.fn().mockResolvedValue({ sessionToken: 'new-seed' });
    vi.mocked(useFxaService).mockReturnValue({
      authPw: authPwMock,
      changePassword: changePasswordMock,
    } as unknown as ReturnType<typeof useFxaService>);
  });

  describe('getProfile', () => {
    it('sends the stored token', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      makeRequestMock.mockResolvedValue(PROFILE);

      await useUserService().getProfile();

      expect(makeRequestMock).toHaveBeenCalledWith('user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'signed-jwt',
      });
    });

    it('hands a failure to the error service and leaves the profile unset', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

      await expect(useUserService().getProfile()).rejects.toThrow();

      expect(useUserStore().profile).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('patches the profile and then reloads it', async () => {
      useUserStore().setToken('signed-jwt');
      makeRequestMock.mockResolvedValueOnce({}).mockResolvedValueOnce(PROFILE);

      await useUserService().updateProfile({ name: 'Renamed' }, 'profile');

      expect(makeRequestMock).toHaveBeenNthCalledWith(1, 'user/profile', RequestType.PATCH, {
        token: 'signed-jwt',
        form: 'profile',
        body: { name: 'Renamed' },
      });
      expect(makeRequestMock).toHaveBeenNthCalledWith(2, 'user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'signed-jwt',
      });
    });

    it('does not reload the profile when the patch fails', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNKNOWN));

      await expect(useUserService().updateProfile({ name: 'Renamed' })).rejects.toThrow();

      expect(makeRequestMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('changeEmail', () => {
    it('proves the current password for the signed-in address and reloads the profile', async () => {
      const userStore = useUserStore();
      userStore.setToken('fxs_session-id');
      userStore.setProfile(PROFILE);
      makeRequestMock.mockResolvedValueOnce({}).mockResolvedValueOnce(PROFILE);

      await useUserService().changeEmail('new@example.com', 'current password');

      expect(authPwMock).toHaveBeenCalledWith('tester@example.com', 'current password');
      expect(makeRequestMock).toHaveBeenNthCalledWith(1, 'user/email', RequestType.POST, {
        token: 'fxs_session-id',
        body: { email: 'new@example.com', authPw: 'a'.repeat(64) },
      });
      expect(makeRequestMock).toHaveBeenCalledTimes(2);
    });

    it('hands a refusal to the error service', async () => {
      const userStore = useUserStore();
      userStore.setToken('fxs_session-id');
      userStore.setProfile(PROFILE);
      const refusal = new Error('Another account already uses this email.');
      makeRequestMock.mockRejectedValueOnce(refusal);

      await expect(useUserService().changeEmail('taken@example.com', 'current password')).rejects.toThrow(refusal);

      expect(handleErrorMock).toHaveBeenCalledWith(refusal);
    });
  });

  describe('changePassword', () => {
    it('changes it from the current session and signs in with the session the server answers', async () => {
      const userStore = useUserStore();
      userStore.setToken('fxs_session-id');
      userStore.setProfile(PROFILE);
      makeRequestMock.mockResolvedValue(PROFILE);

      await useUserService().changePassword('old password', 'new password');

      expect(changePasswordMock).toHaveBeenCalledWith({
        email: 'tester@example.com',
        oldPassword: 'old password',
        newPassword: 'new password',
        sessionTokenId: 'session-id',
      });
      expect(userStore.token).toBe('fxs_id-of-new-seed');
    });

    it('keeps the session when the change fails', async () => {
      const userStore = useUserStore();
      userStore.setToken('fxs_session-id');
      userStore.setProfile(PROFILE);
      changePasswordMock.mockRejectedValue(new Error('Incorrect password'));

      await expect(useUserService().changePassword('wrong', 'new password')).rejects.toThrow('Incorrect password');

      expect(userStore.token).toBe('fxs_session-id');
    });
  });

  describe('logout', () => {
    it('calls the endpoint with the stored token', async () => {
      useUserStore().setToken('signed-jwt');
      makeRequestMock.mockResolvedValue(undefined);

      await useUserService().logout();

      expect(makeRequestMock).toHaveBeenCalledWith('user/logout', RequestType.POST, { token: 'signed-jwt' });
    });

    it('clears the session', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      userStore.setProfile(PROFILE);
      makeRequestMock.mockResolvedValue(undefined);

      await useUserService().logout();

      expect(userStore.loggedIn).toBe(false);
      expect(userStore.profile).toBeNull();
    });

    it('clears the session even when the endpoint fails', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.NETWORK));

      await useUserService().logout();

      expect(userStore.loggedIn).toBe(false);
    });
  });
});
