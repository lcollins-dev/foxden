import { FxaError, fxaErrors } from './fxa-error';
import { DeviceRefusal, DeviceRefusedError } from '@/core/device/device-refusal';
import { OauthRefusal, OauthRefusedError } from '@/core/oauth/oauth-refusal';
import { AccountRefusal, AccountRefusedError } from '@/core/user/account-refusal';

function fromAccountRefusal(refusal: AccountRefusal): FxaError {
  switch (refusal.reason) {
    case 'invalid-invite':
      return fxaErrors.invalidInvite();
    case 'account-exists':
      return fxaErrors.accountExists(refusal.email);
    case 'unknown-account':
      return fxaErrors.unknownAccount(refusal.email);
    case 'account-disabled':
      return fxaErrors.accountDisabled();
    case 'incorrect-password':
      return fxaErrors.incorrectPassword();
    case 'incorrect-email-case':
      return fxaErrors.incorrectEmailCase(refusal.storedEmail);
    case 'invalid-key-fetch-token':
    case 'invalid-password-change-token':
      return fxaErrors.invalidToken();
    case 'invalid-session-token':
      return fxaErrors.invalidToken('Invalid session token');
    case 'setup-required':
      return fxaErrors.setupRequired();
  }
}

function fromDeviceRefusal(refusal: DeviceRefusal): FxaError {
  switch (refusal.reason) {
    case 'incomplete-push':
      return fxaErrors.missingParameter('pushCallback, pushPublicKey and pushAuthKey go together');
    case 'invalid-available-commands':
      return fxaErrors.invalidParameter({ keys: ['availableCommands'] });
    case 'unknown-device':
      return fxaErrors.unknownDevice();
    case 'session-has-device':
      return fxaErrors.deviceSessionConflict(refusal.deviceId);
  }
}

function fromOauthRefusal(refusal: OauthRefusal): FxaError {
  switch (refusal.reason) {
    case 'unknown-client':
      return fxaErrors.unknownClientId(refusal.clientId);
    case 'invalid-scopes':
      return fxaErrors.invalidScopes(refusal.invalidScopes);
    case 'unknown-authorization-code':
      return fxaErrors.unknownAuthorizationCode();
    case 'mismatched-authorization-code':
      return fxaErrors.mismatchAuthorizationCode(refusal.clientId);
    case 'expired-authorization-code':
      return fxaErrors.expiredAuthorizationCode(refusal.expiredAt);
    case 'invalid-pkce-challenge':
      return fxaErrors.invalidPkceChallenge();
    case 'account-disabled':
      return fxaErrors.accountDisabled();
    case 'setup-required':
      return fxaErrors.setupRequired();
    case 'invalid-refresh-token':
      return fxaErrors.invalidToken('Invalid token');
  }
}

/** The errno Mozilla answers a core refusal with, or `null` for anything that is not one. */
export function fxaErrorForRefusal(exception: unknown): FxaError | null {
  if (exception instanceof AccountRefusedError) {
    return fromAccountRefusal(exception.refusal);
  }

  if (exception instanceof DeviceRefusedError) {
    return fromDeviceRefusal(exception.refusal);
  }

  if (exception instanceof OauthRefusedError) {
    return fromOauthRefusal(exception.refusal);
  }

  return null;
}
