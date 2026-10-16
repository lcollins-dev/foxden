import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { decodeProtectedHeader, jwtVerify, JWTPayload, SignJWT } from 'jose';
import { LessThan, Repository } from 'typeorm';

import { AccessToken } from './entities/access-token.entity';
import { User } from '@/core/user/entities/user.entity';

import { SigningKeyService } from './signing-key.service';
import { ConfigService } from '@/config/config.service';

import { OLDSYNC_SCOPE, parseScope } from './oauth-clients';
import { publicUrl } from '@/common/public-url';
import { randomHex } from '@/common/secret-token';

/** 24 hours: the lifetime without a `ttl`, and the most a `ttl` may ask for. */
export const MAX_ACCESS_TOKEN_TTL_SECONDS = 86400;

/** Outlasts the tokenserver's clock tolerance, so a token it still accepts keeps its record. */
const EXPIRED_RECORD_KEPT_MS = 5 * 60 * 1000;

export interface IMintedAccessToken {
  accessToken: string;
  expiresIn: number;
}

export interface IVerifiedAccessToken {
  record: AccessToken;
  user: User;
  scopes: string[];
  claims: JWTPayload;
}

/** RS256 JWT access tokens in the shape of fxa-auth-server/lib/oauth/jwt_access_token.js. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly configService: ConfigService,
    private readonly signingKeyService: SigningKeyService,
    @InjectRepository(AccessToken)
    private readonly accessTokenRepository: Repository<AccessToken>
  ) {}

  get issuer(): string {
    return publicUrl(this.configService);
  }

  /** The `aud` Mozilla gives a Sync token: the tokenserver URL Firefox is configured with. */
  get syncAudience(): string {
    return publicUrl(this.configService, '/token/1.0/sync/1.5');
  }

  async mint(
    user: User,
    sessionId: number,
    clientId: string,
    scope: string,
    authAt: number,
    ttl?: number
  ): Promise<IMintedAccessToken> {
    const now = Date.now();
    const expiresIn = Math.min(ttl ?? MAX_ACCESS_TOKEN_TTL_SECONDS, MAX_ACCESS_TOKEN_TTL_SECONDS);
    const jti = randomHex(32);

    await this.accessTokenRepository.delete({ expiresAt: LessThan(now - EXPIRED_RECORD_KEPT_MS) });
    await this.accessTokenRepository.insert(
      new AccessToken({ jti, userId: user.id, sessionId, clientId, scope, expiresAt: now + expiresIn * 1000 })
    );

    const { kid, privateKey } = this.signingKeyService.getActiveKey();

    const accessToken = await new SignJWT({
      client_id: clientId,
      scope,
      'fxa-generation': user.verifierSetAt,
      auth_time: Math.floor(authAt / 1000),
      acr: 'AAL1',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+JWT', kid })
      .setIssuer(this.issuer)
      .setAudience(parseScope(scope).includes(OLDSYNC_SCOPE) ? this.syncAudience : clientId)
      .setSubject(user.uid)
      .setJti(jti)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + expiresIn)
      .sign(privateKey);

    return { accessToken, expiresIn };
  }

  /** A signed, unexpired, unrevoked token of an enabled account, or null. */
  async verify(token: string): Promise<IVerifiedAccessToken | null> {
    const claims = await this.verifySignature(token, false);

    if (claims?.jti === undefined) {
      return null;
    }

    const record = await this.accessTokenRepository.findOne({ where: { jti: claims.jti }, relations: { user: true } });

    if (record?.user === undefined || !record.user.enabled || record.expiresAt <= Date.now()) {
      return null;
    }

    return { record, user: record.user, scopes: parseScope(record.scope), claims };
  }

  /** Deletes the record behind a token this server signed, even an expired one. Returns whether it was a JWT of ours. */
  async revoke(token: string): Promise<boolean> {
    const claims = await this.verifySignature(token, true);

    if (claims?.jti === undefined) {
      return false;
    }

    await this.accessTokenRepository.delete({ jti: claims.jti });

    return true;
  }

  /** Ignores expiry: an expired token stays recorded until a later mint purges it. */
  async isRecorded(jti: string, fxaUid: string): Promise<boolean> {
    return this.accessTokenRepository.exists({ where: { jti, user: { uid: fxaUid, enabled: true } } });
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.accessTokenRepository.delete({ userId });
  }

  private async verifySignature(token: string, allowExpired: boolean): Promise<JWTPayload | null> {
    try {
      const { kid } = decodeProtectedHeader(token);
      const { kid: activeKid, publicKey } = this.signingKeyService.getActiveKey();

      if (kid !== activeKid) {
        return null;
      }

      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: ['RS256'],
        typ: 'at+JWT',
        issuer: this.issuer,
        currentDate: allowExpired ? new Date(0) : undefined,
      });

      return payload;
    } catch {
      return null;
    }
  }
}
