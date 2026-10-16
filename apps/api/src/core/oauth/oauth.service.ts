import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { FindOptionsRelations, LessThan, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { AuthorizationCode } from './entities/authorization-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '@/core/user/entities/user.entity';

import { AccessTokenService, IVerifiedAccessToken } from './access-token.service';
import { IResolvedSession, SessionService } from '@/core/session/session.service';

import { findClient, IOauthClient, isAllowedScope, OLDSYNC_SCOPE, parseScope, scopeCovers } from './oauth-clients';
import { OauthRefusedError } from './oauth-refusal';
import { hashToken, randomHex, safeEqual } from '@/common/secret-token';

const AUTHORIZATION_CODE_LIFETIME_MS = 10 * 60 * 1000;

/** fxa-auth-server/lib/oauth/keys: the rotation secret is always zero for oldsync. */
const DEFAULT_KEY_ROTATION_SECRET = '0'.repeat(64);

/** Refresh tokens are 32 random bytes in hex, compared without case. */
export const REFRESH_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;

export interface IScopedKey {
  identifier: string;
  keyRotationSecret: string;
  keyRotationTimestamp: number;
}

export interface IAuthorizationRequest {
  state: string;
  scope: string;
  codeChallenge: string;
  keysJwe: string | null;
  offline: boolean;
}

export interface IIssuedCode {
  code: string;
  redirect: string;
  scope: string;
}

export interface IGrantedTokens {
  accessToken: string;
  expiresIn: number;
  scope: string;
  /** Milliseconds. */
  authAt: number;
  refreshToken: string | null;
  keysJwe: string | null;
}

export type IntrospectedToken =
  | { kind: 'access-token'; verified: IVerifiedAccessToken }
  | { kind: 'refresh-token'; refreshToken: RefreshToken; user: User };

const pkceChallenge = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');

@Injectable()
export class OauthService {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly sessionService: SessionService,
    @InjectRepository(AuthorizationCode)
    private readonly authorizationCodeRepository: Repository<AuthorizationCode>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>
  ) {}

  findClientWithThrow(clientId: string): IOauthClient {
    const client = findClient(clientId);

    if (client === undefined) {
      throw new OauthRefusedError({ reason: 'unknown-client', clientId });
    }

    return client;
  }

  /** One entry per key-bearing scope requested, which here is only oldsync. */
  scopedKeys(user: User, clientId: string, scope: string): IScopedKey[] {
    this.requireFinishedSetup(user);
    this.findClientWithThrow(clientId);
    const scopes = this.requireAllowedScopes(scope);

    if (!scopes.includes(OLDSYNC_SCOPE)) {
      return [];
    }

    return [
      {
        identifier: OLDSYNC_SCOPE,
        keyRotationSecret: DEFAULT_KEY_ROTATION_SECRET,
        keyRotationTimestamp: user.keysChangedAt,
      },
    ];
  }

  /** Stores the UI's keys_jwe with a short-lived, single-use code. */
  async authorize(
    { session, user }: IResolvedSession,
    client: IOauthClient,
    request: IAuthorizationRequest
  ): Promise<IIssuedCode> {
    this.requireFinishedSetup(user);

    const scope = this.requireAllowedScopes(request.scope).join(' ');
    const code = randomHex(32);
    const now = Date.now();

    await this.authorizationCodeRepository.delete({ createdAt: LessThan(now - AUTHORIZATION_CODE_LIFETIME_MS) });
    await this.authorizationCodeRepository.insert(
      new AuthorizationCode({
        codeHash: hashToken(code),
        userId: session.userId,
        sessionId: session.id,
        clientId: client.id,
        scope,
        keysJwe: request.keysJwe,
        codeChallenge: request.codeChallenge,
        offline: request.offline,
        authAt: session.authAt,
        now,
      })
    );

    const redirect = new URL(client.redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', request.state);

    return { code, redirect: redirect.toString(), scope };
  }

  async grantAuthorizationCode(
    client: IOauthClient,
    code: string,
    codeVerifier: string,
    ttl: number | undefined
  ): Promise<IGrantedTokens> {
    const authorizationCode = await this.authorizationCodeRepository.findOne({
      where: { codeHash: hashToken(code.toLowerCase()) },
      relations: { user: true, session: true },
    });

    if (
      authorizationCode?.user === undefined ||
      authorizationCode.session === undefined ||
      (await this.sessionService.expireIfDue(authorizationCode.session))
    ) {
      throw new OauthRefusedError({ reason: 'unknown-authorization-code' });
    }

    if (authorizationCode.clientId !== client.id) {
      throw new OauthRefusedError({ reason: 'mismatched-authorization-code', clientId: client.id });
    }

    // Only the request whose delete removes the code may redeem it, so two racing grants cannot both mint tokens.
    const { affected } = await this.authorizationCodeRepository.delete({ id: authorizationCode.id });

    if ((affected ?? 0) === 0) {
      throw new OauthRefusedError({ reason: 'unknown-authorization-code' });
    }

    const expiresAt = authorizationCode.createdAt + AUTHORIZATION_CODE_LIFETIME_MS;

    if (expiresAt < Date.now()) {
      throw new OauthRefusedError({ reason: 'expired-authorization-code', expiredAt: expiresAt });
    }

    if (!safeEqual(pkceChallenge(codeVerifier), authorizationCode.codeChallenge)) {
      throw new OauthRefusedError({ reason: 'invalid-pkce-challenge' });
    }

    if (!authorizationCode.user.enabled) {
      throw new OauthRefusedError({ reason: 'account-disabled' });
    }

    this.requireFinishedSetup(authorizationCode.user);

    const granted = await this.issue(
      authorizationCode.user,
      authorizationCode.sessionId,
      client,
      authorizationCode.scope,
      authorizationCode.authAt,
      ttl,
      authorizationCode.offline
    );

    return { ...granted, keysJwe: authorizationCode.keysJwe };
  }

  async grantFxaCredentials(
    client: IOauthClient,
    { session, user }: IResolvedSession,
    scope: string,
    ttl: number | undefined,
    offline: boolean
  ): Promise<IGrantedTokens> {
    this.requireFinishedSetup(user);

    const allowedScope = this.requireAllowedScopes(scope).join(' ');

    return this.issue(user, session.id, client, allowedScope, session.authAt, ttl, offline);
  }

  /** Mints for the granted scope or a subset of it; `profile` covers every `profile:*`. */
  async grantRefreshToken(
    client: IOauthClient,
    token: string,
    scope: string | undefined,
    ttl: number | undefined
  ): Promise<IGrantedTokens> {
    const refreshToken = await this.findRefreshToken(token);

    if (refreshToken?.user === undefined || refreshToken.clientId !== client.id || !refreshToken.user.enabled) {
      throw new OauthRefusedError({ reason: 'invalid-refresh-token' });
    }

    this.requireFinishedSetup(refreshToken.user);

    const granted = parseScope(refreshToken.scope);
    const requested = scope === undefined ? granted : parseScope(scope);
    const notGranted = requested.filter(entry => !scopeCovers(granted, entry));

    if (notGranted.length > 0) {
      throw new OauthRefusedError({ reason: 'invalid-scopes', invalidScopes: notGranted.join(' ') });
    }

    await this.refreshTokenRepository.update({ id: refreshToken.id }, { lastUsedAt: Date.now() });

    const minted = await this.accessTokenService.mint(
      refreshToken.user,
      refreshToken.sessionId,
      client.id,
      requested.join(' '),
      refreshToken.createdAt,
      ttl
    );

    return {
      accessToken: minted.accessToken,
      expiresIn: minted.expiresIn,
      scope: requested.join(' '),
      authAt: refreshToken.createdAt,
      refreshToken: null,
      keysJwe: null,
    };
  }

  /** Revokes an access token this server signed, or else the refresh token it names; an unknown token is ignored. */
  async revoke(token: string): Promise<void> {
    if (!(await this.accessTokenService.revoke(token)) && REFRESH_TOKEN_PATTERN.test(token)) {
      await this.refreshTokenRepository.delete({ tokenHash: hashToken(token.toLowerCase()) });
    }
  }

  /** A live access token, or else a live refresh token of an enabled account; `null` for anything else. */
  async introspect(token: string): Promise<IntrospectedToken | null> {
    const verified = await this.accessTokenService.verify(token);

    if (verified !== null) {
      return { kind: 'access-token', verified };
    }

    const refreshToken = REFRESH_TOKEN_PATTERN.test(token) ? await this.findRefreshToken(token) : null;

    if (refreshToken?.user === undefined || !refreshToken.user.enabled) {
      return null;
    }

    return { kind: 'refresh-token', refreshToken, user: refreshToken.user };
  }

  /**
   * The session a refresh token was issued under, for the device routes Firefox for Android and iOS authenticate with
   * it. As in Mozilla's refresh-token scheme, the token must carry oldsync and belong to a known (public) client
   * (fxa-auth-server/lib/routes/auth-schemes/refresh-token.js); `null` for anything else. Records the token's use.
   */
  async resolveRefreshTokenSession(token: string): Promise<IResolvedSession | null> {
    if (!REFRESH_TOKEN_PATTERN.test(token)) {
      return null;
    }

    const refreshToken = await this.findRefreshToken(token, { user: { userUserRoles: true } });

    if (refreshToken?.session === undefined || refreshToken.user === undefined || !refreshToken.user.enabled) {
      return null;
    }

    if (findClient(refreshToken.clientId) === undefined || !parseScope(refreshToken.scope).includes(OLDSYNC_SCOPE)) {
      return null;
    }

    await this.refreshTokenRepository.update({ id: refreshToken.id }, { lastUsedAt: Date.now() });

    return { session: refreshToken.session, user: refreshToken.user };
  }

  async listRefreshTokens(userId: number): Promise<RefreshToken[]> {
    return this.refreshTokenRepository.find({ where: { userId } });
  }

  /**
   * Codes go too, as in Mozilla's `removeTokensAndCodes`: a live code would still redeem for tokens carrying the
   * account's new generation.
   */
  async revokeAllForUser(userId: number): Promise<void> {
    await this.authorizationCodeRepository.delete({ userId });
    await this.refreshTokenRepository.delete({ userId });
    await this.accessTokenService.revokeAllForUser(userId);
  }

  /** An account still held to first-time setup gets nothing Firefox could sign in or sync with. */
  private requireFinishedSetup(user: User): void {
    if (user.mustChangePassword) {
      throw new OauthRefusedError({ reason: 'setup-required' });
    }
  }

  private async issue(
    user: User,
    sessionId: number,
    client: IOauthClient,
    scope: string,
    authAt: number,
    ttl: number | undefined,
    offline: boolean
  ): Promise<IGrantedTokens> {
    const minted = await this.accessTokenService.mint(user, sessionId, client.id, scope, authAt, ttl);
    let refreshToken: string | null = null;

    if (offline) {
      refreshToken = randomHex(32);

      await this.replaceRefreshToken(
        new RefreshToken({
          tokenHash: hashToken(refreshToken),
          userId: user.id,
          sessionId,
          clientId: client.id,
          scope,
          now: Date.now(),
        })
      );
    }

    return { accessToken: minted.accessToken, expiresIn: minted.expiresIn, scope, authAt, refreshToken, keysJwe: null };
  }

  /**
   * Keeps one refresh token per session, a new one replacing the old, since no Firefox client holds two. Leaves the
   * session's access tokens valid.
   */
  @Transactional()
  private async replaceRefreshToken(refreshToken: RefreshToken): Promise<void> {
    await this.refreshTokenRepository.delete({ sessionId: refreshToken.sessionId });
    await this.refreshTokenRepository.insert(refreshToken);
  }

  /** `null` once the token's session has expired, which takes the token with it. */
  private async findRefreshToken(
    token: string,
    relations: FindOptionsRelations<RefreshToken> = { user: true }
  ): Promise<RefreshToken | null> {
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: { tokenHash: hashToken(token.toLowerCase()) },
      relations: { ...relations, session: true },
    });

    if (refreshToken?.session === undefined || (await this.sessionService.expireIfDue(refreshToken.session))) {
      return null;
    }

    return refreshToken;
  }

  private requireAllowedScopes(scope: string): string[] {
    const scopes = parseScope(scope);
    const notAllowed = scopes.filter(entry => !isAllowedScope(entry));

    if (scopes.length === 0 || notAllowed.length > 0) {
      throw new OauthRefusedError({ reason: 'invalid-scopes', invalidScopes: notAllowed.join(' ') });
    }

    return scopes;
  }
}
