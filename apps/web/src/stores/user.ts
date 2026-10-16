import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { ProfileResponseDto, UserRoleId } from '@libs/dto';

export const useUserStore = defineStore('user', () => {
  const token = useLocalStorage<string | null>('token', () => null);
  const profile = ref<ProfileResponseDto | null>(null);

  const loggedIn = computed(() => token.value !== null);

  const sessionEnded = ref(false);

  function setToken(newToken: string | null) {
    sessionEnded.value = false;
    token.value = newToken;
  }

  function setProfile(newProfile: ProfileResponseDto | null) {
    profile.value = newProfile;
  }

  function hasRole(...userRoleIds: UserRoleId[]): boolean {
    return userRoleIds.some(userRoleId => profile.value?.userRoleIds.includes(userRoleId) === true);
  }

  function clearAuth() {
    sessionEnded.value = false;
    token.value = null;
    profile.value = null;
  }

  /** Unlike `clearAuth`, the next sign in returns the user to the page they were on. */
  function endSession() {
    clearAuth();
    sessionEnded.value = true;
  }

  return {
    token,
    profile,
    loggedIn,
    sessionEnded,
    setToken,
    setProfile,
    hasRole,
    clearAuth,
    endSession,
  };
});
