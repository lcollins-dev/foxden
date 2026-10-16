<template>
  <form novalidate @submit.prevent="emit('submit')">
    <slot />
  </form>
</template>

<script setup lang="ts">
import { PropType, provide } from 'vue';

import { FORM_NAME_KEY } from './formName';

// Pass the same name as the `form` of the request this form sends.
const props = defineProps({
  name: {
    type: String as PropType<string | null>,
    default: null,
  },
});

const emit = defineEmits<{
  submit: [];
}>();

provide(FORM_NAME_KEY, props.name);
</script>
