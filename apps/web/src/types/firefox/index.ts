/** What Firefox put in the sign-in URL (FxAccountsConfig.sys.mjs `_buildURL`, FxAccountsOAuth.sys.mjs; fxa-client internal/oauth.rs `oauth_flow`). */
export interface IFirefoxOAuthParams {
  context: string;
  service: string;
  clientId: string;
  state: string;
  scope: string;
  accessType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  keysJwk: string;
  /** Firefox for Android and iOS name the account they last held when signing in again. */
  email: string;
}

export type TSignInProgress = 'password' | 'linking' | 'keys' | 'firefox';

export interface IFxaStatus {
  signedInUser: { email: string; uid: string } | null;
  engines: string[];
}

export interface IFxaLoginData {
  email: string;
  uid: string;
  sessionToken: string;
  verified: boolean;
  services: { sync: { offeredEngines?: string[]; declinedEngines?: string[] } };
}

export interface IFxaOAuthLoginData {
  action: 'signin' | 'signup';
  code: string;
  state: string;
  redirect: string;
  scope: string;
}
