import { Injectable, Logger } from '@nestjs/common';
import { decodeProtectedHeader, errors, importJWK, JWK, JWTPayload, jwtVerify, ProtectedHeaderParameters } from 'jose';

import { AccessTokenService } from '@/core/oauth/access-token.service';
import { SigningKeyService } from '@/core/oauth/signing-key.service';

import { TokenserverRefusedError } from './tokenserver-refusal';

export const SYNC_SCOPE = 'https://identity.mozilla.com/apps/oldsync';

const ALGORITHM = 'RS256';
const CLOCK_TOLERANCE_SECONDS = 60;

export interface IAccessTokenClaims {
  fxaUid: string;
  /** Milliseconds; `null` when the token carries none or zero. */
  generation: number | null;
}

/**
 * Verifies OAuth access tokens in-process against the OAuth server's public keys, as syncstorage-rs does locally
 * (`tokenserver-auth/src/oauth/native.rs`, `crypto.rs`), then requires the token's record, so a revoked token stops
 * buying storage credentials before it expires.
 */
@Injectable()
export class AccessTokenVerificationService {
  private readonly logger = new Logger(AccessTokenVerificationService.name);

  constructor(
    private readonly signingKeyService: SigningKeyService,
    private readonly accessTokenService: AccessTokenService
  ) {}

  async verify(token: string): Promise<IAccessTokenClaims> {
    const header = this.decodeHeader(token);
    const keys = await this.loadKeys();

    for (const key of keys.filter(candidate => this.keyMatches(candidate, header))) {
      const payload = await this.verifyWithKey(token, key);

      if (payload !== null) {
        const claims = this.claims(payload);

        await this.requireRecorded(payload.jti, claims.fxaUid);

        return claims;
      }
    }

    throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
  }

  private decodeHeader(token: string): ProtectedHeaderParameters {
    let header: ProtectedHeaderParameters;

    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }

    // FxA sends `at+JWT`; the comparison normalises case and the optional `application/` prefix.
    const typ = header.typ ?? '';
    const normalisedTyp = (typ.includes('/') ? typ : `application/${typ}`).toLowerCase();

    if (header.alg !== ALGORITHM || normalisedTyp !== 'application/at+jwt') {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }

    return header;
  }

  private async loadKeys(): Promise<JWK[]> {
    try {
      return (await this.signingKeyService.getPublicJwks()).keys;
    } catch (error: unknown) {
      this.logger.error({ error }, 'loadKeys(): Failed to load the access token keys');
      throw new TokenserverRefusedError({ reason: 'unavailable' });
    }
  }

  private keyMatches(key: JWK, header: ProtectedHeaderParameters): boolean {
    return header.kid === undefined || key.kid === undefined || key.kid === header.kid;
  }

  /** The payload, or `null` when this key did not sign the token and another may have. */
  private async verifyWithKey(token: string, key: JWK): Promise<JWTPayload | null> {
    let publicKey: Awaited<ReturnType<typeof importJWK>>;

    try {
      publicKey = await importJWK(key, ALGORITHM);
    } catch {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp'],
      });

      return payload;
    } catch (error: unknown) {
      if (error instanceof errors.JWSSignatureVerificationFailed) {
        return null;
      }

      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }
  }

  /** The record must name the token's own subject, so a token forged with the signing key cannot borrow another's. */
  private async requireRecorded(jti: string | undefined, fxaUid: string): Promise<void> {
    if (jti === undefined) {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }

    let recorded: boolean;

    try {
      recorded = await this.accessTokenService.isRecorded(jti, fxaUid);
    } catch (error: unknown) {
      this.logger.error({ error }, 'requireRecorded(): Failed to read the access token record');
      throw new TokenserverRefusedError({ reason: 'unavailable' });
    }

    if (!recorded) {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }
  }

  private claims(payload: JWTPayload): IAccessTokenClaims {
    const generation = payload['fxa-generation'];

    if (
      typeof payload.sub !== 'string' ||
      payload.sub === '' ||
      typeof payload.scope !== 'string' ||
      (generation !== undefined && !Number.isSafeInteger(generation))
    ) {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }

    // syncstorage-rs splits on commas; FxA joins a multi-scope grant with spaces.
    if (!payload.scope.split(/[\s,]+/).includes(SYNC_SCOPE)) {
      throw new TokenserverRefusedError({ reason: 'invalid-credentials' });
    }

    return {
      fxaUid: payload.sub,
      generation: typeof generation === 'number' && generation !== 0 ? generation : null,
    };
  }
}
