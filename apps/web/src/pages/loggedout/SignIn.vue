<template>
  <ui-card class="mx-auto mt-10 max-w-sm">
    <sign-in-form
      title="Sign in to Foxden"
      subtitle="Manage your account and connect Firefox to this server."
      :sign-in="doSignIn"
      progress="Checking your password. This takes a second or two."
    />
  </ui-card>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';

import { apiTokenForSession } from '@/utils/apiToken';
import { signInReturnPath } from '@/utils/signInReturnPath';

import { useUserService } from '@/services/api/UserService';
import { useFxaService } from '@/services/fxa/FxaService';
import { useUserStore } from '@/stores/user';

import SignInForm from '@/components/SignInForm.vue';
import { UiCard } from '@/components/ui';

import { HOME_PATH } from '@/router/middleware/auth';

const route = useRoute();
const router = useRouter();

const fxaService = useFxaService();
const userService = useUserService();
const userStore = useUserStore();

const doSignIn = async (email: string, password: string) => {
  const session = await fxaService.signIn(email, password);

  userStore.setToken(await apiTokenForSession(session.sessionToken));
  await userService.getProfile();
  await router.push(signInReturnPath(route.query) ?? HOME_PATH);
};
</script>
