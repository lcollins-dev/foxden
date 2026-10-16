import { computed, inject, onMounted, onUnmounted } from 'vue';

import { useErrorStore } from '@/stores/error';

import { FORM_NAME_KEY } from './formName';

interface IFieldErrorProps {
  label: string;
  path?: string;
  error: string;
}

/** The page's own `error` wins over the server's. Registers the label, which the validation toast names the field by. */
export const useFieldError = (props: IFieldErrorProps) => {
  const errorStore = useErrorStore();
  const form = inject(FORM_NAME_KEY, null);

  onMounted(() => {
    if (props.path !== undefined) {
      errorStore.setFormLabel(form, props.path, props.label);
    }
  });

  onUnmounted(() => {
    if (props.path !== undefined) {
      errorStore.removeFormLabel(form, props.path);
    }
  });

  return computed(() => {
    if (props.error !== '') {
      return props.error;
    }

    return props.path === undefined ? '' : (errorStore.getFieldError(form, props.path) ?? '');
  });
};
