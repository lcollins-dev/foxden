import { Injectable } from '@nestjs/common';

import { AccessTokenVerificationService } from '@/core/tokenserver/access-token-verification.service';
import { TokenserverService } from '@/core/tokenserver/tokenserver.service';

import { parseKeyId } from './key-id';
import { tokenserverErrors } from './tokenserver-error';

export const TOKEN_DURATION_SECONDS = 3600;

const SUPPORTED_APPLICATION = 'sync';
const SUPPORTED_VERSION = '1.5';
const DURATION_PATTERN = /^[0-9]+$/;

export interface ITokenRequest {
  application: string;
  version: string;
  authorization: string | undefined;
  keyId: string | undefined;
  clientState: string | undefined;
  duration: string | undefined;
}

export interface ITokenResponse {
  id: string;
  key: string;
  uid: number;
  api_endpoint: string;
  duration: number;
  hashed_fxa_uid: string;
  hashalg: string;
  node_type: string;
}

/** Splits `Bearer <token>` on the first space (syncstorage-rs `Token::from_request`). */
function bearerToken(authorization: string | undefined): string {
  if (authorization === undefined || !/^[\x20-\x7e\t]*$/.test(authorization)) {
    throw tokenserverErrors.unauthorized();
  }

  const separator = authorization.indexOf(' ');

  if (separator === -1) {
    throw tokenserverErrors.unauthorized();
  }

  if (authorization.slice(0, separator).toLowerCase() !== 'bearer') {
    throw tokenserverErrors.unsupportedScheme();
  }

  return authorization.slice(separator + 1);
}

/** A client may shorten its token's life but never lengthen it; a bad value falls back silently. */
function tokenDuration(requested: string | undefined): number {
  if (requested === undefined || !DURATION_PATTERN.test(requested)) {
    return TOKEN_DURATION_SECONDS;
  }

  return Math.min(Number(requested), TOKEN_DURATION_SECONDS);
}

/**
 * Exchanges an OAuth access token for storage credentials, checking the request in syncstorage-rs's order so the same
 * error wins (`TokenserverRequest::from_request`, `syncserver/src/tokenserver/extractors.rs`).
 */
@Injectable()
export class TokenExchangeService {
  constructor(
    private readonly accessTokenVerificationService: AccessTokenVerificationService,
    private readonly tokenserverService: TokenserverService
  ) {}

  async exchange(request: ITokenRequest): Promise<ITokenResponse> {
    const claims = await this.accessTokenVerificationService.verify(bearerToken(request.authorization));
    const claimedKeys = parseKeyId(request.keyId, request.clientState);

    if (request.application !== SUPPORTED_APPLICATION) {
      throw tokenserverErrors.unsupportedApplication();
    }

    if (request.version !== SUPPORTED_VERSION) {
      throw tokenserverErrors.unsupportedVersion(request.version);
    }

    const duration = tokenDuration(request.duration);
    const credentials = await this.tokenserverService.issueToken(claims, claimedKeys, duration);

    return {
      id: credentials.id,
      key: credentials.key,
      uid: credentials.uid,
      api_endpoint: `${credentials.node}/1.5/${credentials.uid}`,
      duration,
      hashed_fxa_uid: credentials.hashedFxaUid,
      hashalg: 'sha256',
      node_type: 'sqlite',
    };
  }
}
