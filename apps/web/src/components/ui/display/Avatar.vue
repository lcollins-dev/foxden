<template>
  <span
    class="inline-flex shrink-0 select-none items-center justify-center font-medium leading-none"
    :class="[
      SIZE_CLASSES[props.size],
      props.type === 'gray' ? 'bg-emphasis text-muted' : 'bg-primary-soft text-accent',
      props.round ? 'rounded-full' : 'rounded-lg',
    ]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'size-7 text-xs',
  md: 'size-8 text-sm',
  lg: 'size-11 text-lg',
};

const props = defineProps({
  size: {
    type: String as PropType<AvatarSize>,
    default: 'md',
  },
  type: {
    type: String as PropType<'primary' | 'gray'>,
    default: 'primary',
  },
  round: {
    type: Boolean,
    default: false,
  },
});
</script>
