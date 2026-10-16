import { ApiError, ApiErrorType } from '@/types/api/error';
import { AppError, ValidationError } from '@/types/error';
import { Notification, NotificationType } from '@/types/notification';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

export const useErrorService = () => {
  const errorStore = useErrorStore();
  const notificationStore = useNotificationStore();

  const userStore = useUserStore();

  /**
   * Shows the error and rethrows it: a validation error goes to the error store, which shows it under the fields with
   * a matching `path` and in a toast; any other app error is a toast.
   */
  function handleError(error: unknown): never {
    if (error instanceof ApiError && error.type === ApiErrorType.UNAUTHORIZED) {
      userStore.endSession();
    }

    if (error instanceof ValidationError) {
      errorStore.setValidationError(error);
    } else if (error instanceof AppError) {
      notificationStore.addNotification(new Notification(error.message, NotificationType.ERROR));
    }

    throw error;
  }

  function clearValidationError() {
    errorStore.clearValidationError();
  }

  return {
    handleError,
    clearValidationError,
  };
};
