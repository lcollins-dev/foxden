import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { PublicBaseUrlService } from '@/common/public-base-url.service';
import { SyncSecretService } from '@/core/tokenserver/sync-secret.service';

import { verifyHawkRequest } from './hawk';
import { storageErrors } from './storage-error';

// syncstorage-rs `MYSQL_UID_REGEX`; any other uid segment is an unknown route.
const UID_PATTERN = /^[0-9]{1,10}$/;
const INFO_COLLECTIONS_PATH = /^\/storage\/1\.5\/[^/]+\/info\/collections$/;

// Bounded, so a storage token kept by a signed-out device or a disabled account stops working an hour after expiry.
const INFO_COLLECTIONS_EXPIRY_GRACE_SECONDS = 3600;

type HawkAuthenticatedRequest = Request & { syncUid?: number };

/** Authenticates a storage request with Hawk and requires the path's uid to be the token's. */
@Injectable()
export class HawkAuthGuard implements CanActivate {
  constructor(
    private readonly syncSecrets: SyncSecretService,
    private readonly publicBaseUrlService: PublicBaseUrlService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HawkAuthenticatedRequest>();
    const pathUid = request.params.uid;

    if (!UID_PATTERN.test(pathUid)) {
      throw storageErrors.notFound();
    }

    const path = request.originalUrl.split('?')[0];

    const payload = verifyHawkRequest(
      {
        authorization: request.headers.authorization,
        method: request.method,
        resource: `${this.publicBaseUrlService.pathPrefix}${request.originalUrl}`,
        host: this.publicBaseUrlService.host,
        port: this.publicBaseUrlService.port,
        nowMs: Date.now(),
        expiryGraceSeconds: INFO_COLLECTIONS_PATH.test(path) ? INFO_COLLECTIONS_EXPIRY_GRACE_SECONDS : 0,
      },
      { masterSecret: this.syncSecrets.masterSecret, signingSecret: this.syncSecrets.signingSecret }
    );

    if (payload === null) {
      throw storageErrors.unauthorized();
    }

    // syncstorage-rs answers a uid that is not the token's with 400.
    if (Number(pathUid) !== payload.uid) {
      throw storageErrors.badRequest();
    }

    request.syncUid = payload.uid;

    return true;
  }
}

/** The uid `HawkAuthGuard` authenticated for this request. */
export function authenticatedUid(request: HawkAuthenticatedRequest): number {
  if (request.syncUid === undefined) {
    throw storageErrors.unauthorized();
  }

  return request.syncUid;
}
