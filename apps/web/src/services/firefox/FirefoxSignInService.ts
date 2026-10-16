import { buildKeysJwe, deriveOldsyncKey, OLDSYNC_SCOPE, ScopedKeys } from '@libs/fxa-crypto';

import { AppError } from '@/types/error';
import type { IFirefoxOAuthParams, TSignInProgress } from '@/types/firefox';

import { useErrorService } from '../ErrorService';
import { useFxaService } from '../fxa/FxaService';
import { useWebChannelService } from './WebChannelService';

export const useFirefoxSignInService = () => {
  const errorService = useErrorService();
  const fxaService = useFxaService();
  const webChannelService = useWebChannelService();

  /**
   * Signs in and hands the session to Firefox, in the order of Mozilla's content server
   * (fxa-settings/src/pages/Signin/utils.ts): login and keys, `can_link_account`, the authorization code carrying
   * `keys_jwe` for Firefox's `keys_jwk`, then `fxaccounts:login` and `fxaccounts:oauth_login`.
   */
  async function signIn(
    params: IFirefoxOAuthParams,
    email: string,
    password: string,
    onProgress: (progress: TSignInProgress) => void
  ): Promise<void> {
    onProgress('password');
    const session = await fxaService.signIn(email, password, { keys: true, service: params.service });

    onProgress('linking');
    const linked = await webChannelService
      .canLinkAccount(session.email, session.uid)
      .catch((error: unknown) => errorService.handleError(error));

    if (!linked) {
      await fxaService.destroySession(session.sessionToken).catch(() => undefined);
      return errorService.handleError(new AppError('Sign-in was cancelled in Firefox.'));
    }

    onProgress('keys');
    const keyData = await fxaService.scopedKeyData(session.sessionToken, params.clientId, params.scope);
    const oldsync = keyData[OLDSYNC_SCOPE];

    if (oldsync === undefined) {
      return errorService.handleError(new AppError('The server returned no Sync key metadata.'));
    }

    const scopedKeys: ScopedKeys = {
      [OLDSYNC_SCOPE]: await deriveOldsyncKey(session.kB, oldsync.keyRotationTimestamp),
    };

    const authorization = await fxaService.authorize(session.sessionToken, {
      client_id: params.clientId,
      state: params.state,
      scope: params.scope,
      response_type: 'code',
      access_type: params.accessType,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      keys_jwe: await buildKeysJwe(params.keysJwk, scopedKeys),
      service: params.service,
    });

    onProgress('firefox');
    webChannelService.login({
      email: session.email,
      uid: session.uid,
      sessionToken: session.sessionToken,
      verified: true,
      services: { sync: {} },
    });

    // Firefox looks the flow up by the state from its own URL, never by one the server echoes.
    webChannelService.oauthLogin({
      action: 'signin',
      code: authorization.code,
      state: params.state,
      redirect: authorization.redirect,
      scope: authorization.scope,
    });
  }

  return { signIn };
};
