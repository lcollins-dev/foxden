import { Injectable, OnModuleInit } from '@nestjs/common';
import { hkdfSync, randomBytes } from 'node:crypto';

import { SyncDatabaseService } from '@/database/sync-database.service';

import { deriveSigningSecret } from './sync-token';

const MASTER_SECRET_BYTES = 32;
const METRICS_HASH_INFO = 'firefox-sync/tokenserver/metrics-hash';

interface ISecrets {
  master: string;
  signing: Buffer;
  metricsHash: Buffer;
}

/**
 * The tokenserver's master secret, generated on first start and kept in the database, so storage tokens stay valid
 * across restarts. Everything else the tokenserver keys is derived from it.
 */
@Injectable()
export class SyncSecretService implements OnModuleInit {
  private secrets: ISecrets | undefined;

  constructor(private readonly syncDatabase: SyncDatabaseService) {}

  async onModuleInit(): Promise<void> {
    const master = await this.syncDatabase.write(db => {
      db.prepare('INSERT INTO tokenserver_secret (id, secret, created_at) VALUES (1, ?, ?) ON CONFLICT DO NOTHING').run(
        randomBytes(MASTER_SECRET_BYTES).toString('hex'),
        Date.now()
      );

      return db.prepare<[], { secret: string }>('SELECT secret FROM tokenserver_secret WHERE id = 1').get();
    });

    if (master === undefined) {
      throw new Error('The tokenserver secret is missing');
    }

    this.secrets = {
      master: master.secret,
      signing: deriveSigningSecret(master.secret),
      metricsHash: Buffer.from(hkdfSync('sha256', master.secret, '', METRICS_HASH_INFO, MASTER_SECRET_BYTES)),
    };
  }

  get masterSecret(): string {
    return this.loaded().master;
  }

  get signingSecret(): Buffer {
    return this.loaded().signing;
  }

  get metricsHashSecret(): Buffer {
    return this.loaded().metricsHash;
  }

  private loaded(): ISecrets {
    if (this.secrets === undefined) {
      throw new Error('The tokenserver secret is read before the module initialised');
    }

    return this.secrets;
  }
}
