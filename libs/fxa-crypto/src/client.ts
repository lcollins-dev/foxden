import { bytesToHex, xorBytes } from './bytes';
import {
  createClientSalt,
  IStretchedPassword,
  createSignUpKeys,
  keyFetchTokenBearer,
  passwordChangeTokenBearer,
  sessionTokenBearer,
  stretchPasswordV2,
  unbundleKeyFetchResponse,
  unwrapKb,
} from './onepw';

/** Errnos the sign-in pages react to (fxa/libs/accounts/errors/src/constants.ts). */
export const FXA_ERRNO = {
  ACCOUNT_EXISTS: 101,
  UNKNOWN_ACCOUNT: 102,
  INCORRECT_PASSWORD: 103,
  INVALID_TOKEN: 110,
  THROTTLED: 114,
  INCORRECT_EMAIL_CASE: 120,
  INVALID_INVITE: 207,
  ACCOUNT_DISABLED: 240,
  /** Ours, not Mozilla's: the account must change its default password in the web app first. */
  SETUP_REQUIRED: 250,
} as const;

export class FxaClientError extends Error {
  constructor(
    readonly code: number,
    readonly errno: number,
    message: string,
    /** The stored address, sent with errno 120. */
    readonly email: string | null = null
  ) {
    super(message);
    this.name = 'FxaClientError';
  }
}

export interface IFxaSession {
  uid: string;
  email: string;
  /** The session token seed as hex; Firefox and our `/api/v1` authenticate with its token id. */
  sessionToken: string;
  /** Seconds. */
  authAt: number;
}

export interface IFxaSessionWithKeys extends IFxaSession {
  kB: Uint8Array<ArrayBuffer>;
}

export interface ISignUpRequest {
  email: string;
  password: string;
  inviteToken: string;
  service?: string;
}

export interface IChangePasswordRequest {
  email: string;
  oldPassword: string;
  newPassword: string;
  /** What an `/api/v1` bearer token carries after `fxs_`. */
  sessionTokenId: string;
}

export interface IScopedKeyData {
  identifier: string;
  keyRotationSecret: string;
  keyRotationTimestamp: number;
}

/** fxa-auth-server/lib/routes/oauth/authorization.js, as Mozilla's content server sends it. */
export interface IAuthorizationRequest {
  client_id: string;
  state: string;
  scope: string;
  response_type: 'code';
  access_type?: string;
  code_challenge: string;
  code_challenge_method: string;
  keys_jwe?: string;
  service?: string;
}

export interface IAuthorizationResponse {
  code: string;
  state: string;
  redirect: string;
  scope: string;
}

type TJson = Record<string, unknown>;

interface IRequestOptions {
  body?: unknown;
  authorization?: string;
}

const isRecord = (value: unknown): value is TJson => typeof value === 'object' && value !== null;

function readString(json: TJson, key: string): string {
  const value = json[key];

  if (typeof value !== 'string') {
    throw new FxaClientError(500, 999, `Unexpected response: ${key} is missing`);
  }

  return value;
}

function readNumber(json: TJson, key: string): number {
  const value = json[key];

  if (typeof value !== 'number') {
    throw new FxaClientError(500, 999, `Unexpected response: ${key} is missing`);
  }

  return value;
}

/** Our counterpart of fxa-auth-client: v2 key stretching, login, create, key fetch and OAuth authorization. */
export class FxaAuthClient {
  /** @param authBaseUrl the auth server base including `/v1`, e.g. `https://sync.example.com/auth/v1`. */
  constructor(private readonly authBaseUrl: string) {}

  async accountExists(email: string): Promise<boolean> {
    const response = await this.request('POST', '/account/status', { body: { email } });

    return response.exists === true;
  }

  async signIn(
    email: string,
    password: string,
    options: { keys: true; service?: string }
  ): Promise<IFxaSessionWithKeys>;
  async signIn(email: string, password: string, options?: { keys?: false; service?: string }): Promise<IFxaSession>;
  async signIn(
    email: string,
    password: string,
    options: { keys?: boolean; service?: string } = {}
  ): Promise<IFxaSession | IFxaSessionWithKeys> {
    const stretched = await this.stretch(email, password);
    const authPW = bytesToHex(stretched.authPW);
    const withKeys = options.keys === true;

    const { email: acceptedEmail, response: login } = await this.retryWithStoredEmail(email, attemptEmail =>
      this.login(attemptEmail, authPW, withKeys, options.service)
    );

    const session: IFxaSession = {
      uid: readString(login, 'uid'),
      email: acceptedEmail,
      sessionToken: readString(login, 'sessionToken'),
      authAt: readNumber(login, 'authAt'),
    };

    if (!withKeys) {
      return session;
    }

    const kB = await this.fetchKb(readString(login, 'keyFetchTokenVersion2'), stretched.unwrapBKey);

    return { ...session, kB };
  }

  /** hex(authPW), which `/api/v1` takes as proof of the current password. */
  async authPw(email: string, password: string): Promise<string> {
    return bytesToHex((await this.stretch(email, password)).authPW);
  }

  /**
   * Mozilla's password change (fxa-auth-client `passwordChange`), v2 only, keeping kB. The server ends every session
   * of the account, the calling one included, and answers a new one for the caller.
   */
  async changePassword(request: IChangePasswordRequest): Promise<IFxaSession> {
    const status = await this.request('POST', '/account/credentials/status', { body: { email: request.email } });
    const clientSalt = readString(status, 'clientSalt');
    const oldStretched = await stretchPasswordV2(request.oldPassword, clientSalt);
    const sessionAuthorization = `Bearer fxs_${request.sessionTokenId}`;

    const { email: acceptedEmail, response: started } = await this.retryWithStoredEmail(request.email, attemptEmail =>
      this.request('POST', '/password/change/start', {
        body: { email: attemptEmail, oldAuthPW: bytesToHex(oldStretched.authPW) },
        authorization: sessionAuthorization,
      })
    );

    const kB = await this.fetchKb(readString(started, 'keyFetchToken2'), oldStretched.unwrapBKey);

    // Mozilla keeps the account's client salt.
    const newStretched = await stretchPasswordV2(request.newPassword, clientSalt);

    const finished = await this.request('POST', '/password/change/finish', {
      body: {
        authPWVersion2: bytesToHex(newStretched.authPW),
        wrapKbVersion2: bytesToHex(xorBytes(kB, newStretched.unwrapBKey)),
        clientSalt,
        sessionToken: request.sessionTokenId,
      },
      authorization: await passwordChangeTokenBearer(readString(started, 'passwordChangeToken')),
    });

    return {
      uid: readString(finished, 'uid'),
      email: acceptedEmail,
      sessionToken: readString(finished, 'sessionToken'),
      authAt: readNumber(finished, 'authAt'),
    };
  }

  async signUp(request: ISignUpRequest): Promise<IFxaSessionWithKeys> {
    const clientSalt = createClientSalt();
    const stretched = await stretchPasswordV2(request.password, clientSalt);
    const { kB, wrapKb } = createSignUpKeys(stretched.unwrapBKey);

    const created = await this.request('POST', '/account/create', {
      body: {
        email: request.email,
        authPWVersion2: bytesToHex(stretched.authPW),
        wrapKbVersion2: bytesToHex(wrapKb),
        clientSalt,
        inviteToken: request.inviteToken,
        service: request.service,
      },
    });

    return {
      uid: readString(created, 'uid'),
      email: request.email,
      sessionToken: readString(created, 'sessionToken'),
      authAt: readNumber(created, 'authAt'),
      kB,
    };
  }

  async scopedKeyData(
    sessionToken: string,
    clientId: string,
    scope: string
  ): Promise<Partial<Record<string, IScopedKeyData>>> {
    const response = await this.request('POST', '/account/scoped-key-data', {
      body: { client_id: clientId, scope },
      authorization: await sessionTokenBearer(sessionToken),
    });

    const result: Partial<Record<string, IScopedKeyData>> = {};

    for (const [key, entry] of Object.entries(response)) {
      if (isRecord(entry)) {
        result[key] = {
          identifier: readString(entry, 'identifier'),
          keyRotationSecret: readString(entry, 'keyRotationSecret'),
          keyRotationTimestamp: readNumber(entry, 'keyRotationTimestamp'),
        };
      }
    }

    return result;
  }

  async authorize(sessionToken: string, request: IAuthorizationRequest): Promise<IAuthorizationResponse> {
    const response = await this.request('POST', '/oauth/authorization', {
      body: request,
      authorization: await sessionTokenBearer(sessionToken),
    });

    return {
      code: readString(response, 'code'),
      state: readString(response, 'state'),
      redirect: readString(response, 'redirect'),
      scope: readString(response, 'scope'),
    };
  }

  async destroySession(sessionToken: string): Promise<void> {
    await this.request('POST', '/session/destroy', { body: {}, authorization: await sessionTokenBearer(sessionToken) });
  }

  private async stretch(email: string, password: string): Promise<IStretchedPassword> {
    const status = await this.request('POST', '/account/credentials/status', { body: { email } });

    return stretchPasswordV2(password, readString(status, 'clientSalt'));
  }

  /** Errno 120 carries the stored case; the v2 salt ignores the address, so the same authPW retries once. */
  private async retryWithStoredEmail(
    email: string,
    attempt: (attemptEmail: string) => Promise<TJson>
  ): Promise<{ email: string; response: TJson }> {
    try {
      return { email, response: await attempt(email) };
    } catch (error) {
      if (
        !(error instanceof FxaClientError) ||
        error.errno !== FXA_ERRNO.INCORRECT_EMAIL_CASE ||
        error.email === null
      ) {
        throw error;
      }

      return { email: error.email, response: await attempt(error.email) };
    }
  }

  private async fetchKb(keyFetchToken: string, unwrapBKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const keys = await this.request('GET', '/account/keys', {
      authorization: await keyFetchTokenBearer(keyFetchToken),
    });
    const bundle = await unbundleKeyFetchResponse(keyFetchToken, readString(keys, 'bundle'));

    return unwrapKb(bundle.wrapKb, unwrapBKey);
  }

  private login(email: string, authPW: string, withKeys: boolean, service: string | undefined): Promise<TJson> {
    return this.request('POST', `/account/login${withKeys ? '?keys=true' : ''}`, {
      body: { email, authPW, service },
    });
  }

  private async request(method: 'GET' | 'POST', path: string, options: IRequestOptions = {}): Promise<TJson> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.authorization !== undefined) {
      headers.Authorization = options.authorization;
    }

    let response: Response;

    try {
      response = await fetch(`${this.authBaseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new FxaClientError(0, 999, `Network error: ${String(error)}`);
    }

    const json: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      if (isRecord(json) && typeof json.errno === 'number') {
        const message = typeof json.message === 'string' ? json.message : response.statusText;
        const email = typeof json.email === 'string' ? json.email : null;

        throw new FxaClientError(response.status, json.errno, message, email);
      }

      throw new FxaClientError(response.status, 999, response.statusText);
    }

    if (!isRecord(json)) {
      throw new FxaClientError(response.status, 999, 'Unexpected response: not a JSON object');
    }

    return json;
  }
}
