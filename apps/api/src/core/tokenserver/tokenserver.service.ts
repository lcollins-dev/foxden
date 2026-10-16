import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { IAccessTokenClaims } from './access-token-verification.service';
import { SyncSecretService } from './sync-secret.service';
import { PublicBaseUrlService } from '@/common/public-base-url.service';
import { SyncDatabaseService } from '@/database/sync-database.service';

import { makeToken } from './sync-token';
import { nextUserKeys, validateRequestKeys } from './tokenserver-rules';
import { TokenserverUserRepository } from './tokenserver-user.repository';

export const STORAGE_PATH = '/storage';

const FXA_KID_TIMESTAMP_DIGITS = 13;
const HASH_HEX_LENGTH = 32;

export interface IClaimedKeys {
  /** Milliseconds; `null` when the client sent zero. */
  keysChangedAt: number | null;

  /** Lowercase hex of the key fingerprint, `''` for an empty one. */
  clientState: string;
}

export interface ISyncCredentials {
  id: string;
  key: string;
  uid: number;
  /** The storage node the token is for, under the public base URL. */
  node: string;
  hashedFxaUid: string;
}

/**
 * Issues storage credentials for a verified account (syncstorage-rs `syncserver/src/tokenserver/handlers.rs`): the
 * claimed keys are checked against what the account reported before, and a new client state gets a new storage uid.
 */
@Injectable()
export class TokenserverService {
  constructor(
    private readonly userRepository: TokenserverUserRepository,
    private readonly syncDatabase: SyncDatabaseService,
    private readonly syncSecrets: SyncSecretService,
    private readonly publicBaseUrlService: PublicBaseUrlService
  ) {}

  async issueToken(
    claims: IAccessTokenClaims,
    claimedKeys: IClaimedKeys,
    durationSeconds: number
  ): Promise<ISyncCredentials> {
    const hashedFxaUid = this.metricsHash(claims.fxaUid);
    const requestKeys = { generation: claims.generation, ...claimedKeys };

    const { uid, keys } = await this.syncDatabase.write(db => {
      const now = Date.now();
      const user = this.userRepository.getOrCreate(db, claims.fxaUid, requestKeys, now);

      validateRequestKeys(requestKeys, user);

      const nextKeys = nextUserKeys(requestKeys, user);

      return {
        uid: this.userRepository.update(db, claims.fxaUid, user, claimedKeys.clientState, nextKeys, now),
        keys: nextKeys,
      };
    });

    const node = `${this.publicBaseUrlService.url}${STORAGE_PATH}`;
    const kidTimestamp = String(keys.keysChangedAt ?? keys.generation).padStart(FXA_KID_TIMESTAMP_DIGITS, '0');

    const token = makeToken(
      {
        node,
        fxa_kid: `${kidTimestamp}-${Buffer.from(claimedKeys.clientState, 'hex').toString('base64url')}`,
        fxa_uid: claims.fxaUid,
        // The literal `none` stands in for the device id BrowserID used to carry.
        hashed_device_id: this.metricsHash(`${hashedFxaUid}none`),
        hashed_fxa_uid: hashedFxaUid,
        expires: Math.floor(Date.now() / 1000) + durationSeconds,
        uid,
        tokenserver_origin: 'rust',
      },
      this.syncSecrets.masterSecret
    );

    return { id: token.id, key: token.key, uid, node, hashedFxaUid };
  }

  /**
   * Refuses the account's access tokens minted before a password change, as syncstorage-rs's password-change event
   * does (`syncserver/src/tokenserver/handlers.rs`): the generation becomes the change time less one millisecond, so a
   * token carrying the new `fxa-generation` still passes.
   */
  async recordPasswordChange(fxaUid: string, changedAt: number): Promise<void> {
    await this.syncDatabase.write(db => {
      this.userRepository.raiseGeneration(db, fxaUid, changedAt - 1);
    });
  }

  /**
   * Discards the account's storage when a re-key gives it a new kB, since nobody holds the old kB that encrypted it. The
   * generation is raised as for a password change, and every uid is replaced and wiped at once rather than when
   * Firefox first claims the new keys, so a storage token from before the reset cannot keep syncing under the old kB.
   */
  async recordKeyChange(fxaUid: string, changedAt: number): Promise<void> {
    await this.syncDatabase.write(db => {
      this.userRepository.replaceAll(db, fxaUid, changedAt - 1, Date.now());
    });
  }

  /**
   * Wipes a deleted account's storage and keeps its rows as tombstones, so an access token minted before the deletion
   * cannot allocate it fresh storage.
   */
  async retireAccount(fxaUid: string): Promise<void> {
    await this.syncDatabase.write(db => {
      this.userRepository.retire(db, fxaUid, Date.now());
    });
  }

  private metricsHash(message: string): string {
    return createHmac('sha256', this.syncSecrets.metricsHashSecret)
      .update(message, 'utf8')
      .digest('hex')
      .slice(0, HASH_HEX_LENGTH);
  }
}
