import {
  FxaAuthClient,
  IAuthorizationRequest,
  IAuthorizationResponse,
  IChangePasswordRequest,
  IFxaSession,
  IFxaSessionWithKeys,
  IScopedKeyData,
  ISignUpRequest,
} from '@libs/fxa-crypto';

import { useNotificationStore } from '@/stores/notification';

import { useErrorService } from '../ErrorService';
import { toAppError } from './fxaError';

const client = new FxaAuthClient('/auth/v1');

export const useFxaService = () => {
  const errorService = useErrorService();
  const notificationStore = useNotificationStore();

  const call = <T>(request: Promise<T>): Promise<T> =>
    request
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(toAppError(error)));

  // A call that changes the account clears every toast once it succeeds, as the api's changing requests do.
  const change = async <T>(request: Promise<T>): Promise<T> => {
    const result = await call(request);

    notificationStore.clearAllNotifications();

    return result;
  };

  function accountExists(email: string): Promise<boolean> {
    return call(client.accountExists(email));
  }

  function signIn(
    email: string,
    password: string,
    options: { keys: true; service?: string }
  ): Promise<IFxaSessionWithKeys>;
  function signIn(email: string, password: string, options?: { keys?: false; service?: string }): Promise<IFxaSession>;
  function signIn(
    email: string,
    password: string,
    options: { keys?: boolean; service?: string } = {}
  ): Promise<IFxaSession | IFxaSessionWithKeys> {
    return options.keys === true
      ? change(client.signIn(email, password, { keys: true, service: options.service }))
      : change(client.signIn(email, password, { keys: false, service: options.service }));
  }

  function authPw(email: string, password: string): Promise<string> {
    return call(client.authPw(email, password));
  }

  function changePassword(request: IChangePasswordRequest): Promise<IFxaSession> {
    return change(client.changePassword(request));
  }

  function signUp(request: ISignUpRequest): Promise<IFxaSessionWithKeys> {
    return change(client.signUp(request));
  }

  function scopedKeyData(
    sessionToken: string,
    clientId: string,
    scope: string
  ): Promise<Partial<Record<string, IScopedKeyData>>> {
    return call(client.scopedKeyData(sessionToken, clientId, scope));
  }

  function authorize(sessionToken: string, request: IAuthorizationRequest): Promise<IAuthorizationResponse> {
    return change(client.authorize(sessionToken, request));
  }

  function destroySession(sessionToken: string): Promise<void> {
    return change(client.destroySession(sessionToken));
  }

  return { accountExists, signIn, authPw, changePassword, signUp, scopedKeyData, authorize, destroySession };
};
