import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { exportJWK, generateKeyPair, importJWK, JSONWebKeySet, JWK } from 'jose';
import { Repository } from 'typeorm';

import { SigningKey } from './entities/signing-key.entity';

import { randomHex } from '@/common/secret-token';

/** The JWKS entry shape of fxa-auth-server/lib/oauth/keys.ts. */
export interface IPublicJwk extends JWK {
  'fxa-createdAt': number;
}

export interface IActiveSigningKey {
  kid: string;
  privateKey: CryptoKey | Uint8Array;
  publicKey: CryptoKey | Uint8Array;
}

/** Holds the RS256 key that signs access tokens: generated on first start and kept in the database. */
@Injectable()
export class SigningKeyService implements OnModuleInit {
  private readonly logger = new Logger(SigningKeyService.name);

  private activeKey: IActiveSigningKey | null = null;

  private publicJwks: JSONWebKeySet = { keys: [] };

  constructor(
    @InjectRepository(SigningKey)
    private readonly signingKeyRepository: Repository<SigningKey>
  ) {}

  async onModuleInit(): Promise<void> {
    const stored = (await this.signingKeyRepository.find({ order: { createdAt: 'DESC' }, take: 1 })).at(0);
    const signingKey = stored ?? (await this.generate());

    const privateJwk = this.parseJwk(signingKey.privateJwkJson);
    const publicJwk = this.toPublicJwk(signingKey, privateJwk);

    this.activeKey = {
      kid: signingKey.kid,
      privateKey: await importJWK(privateJwk, 'RS256'),
      publicKey: await importJWK(publicJwk, 'RS256'),
    };
    this.publicJwks = { keys: [publicJwk] };
  }

  getActiveKey(): IActiveSigningKey {
    if (this.activeKey === null) {
      throw new Error('The signing key is not loaded yet');
    }

    return this.activeKey;
  }

  getPublicJwks(): Promise<JSONWebKeySet> {
    return Promise.resolve(this.publicJwks);
  }

  private async generate(): Promise<SigningKey> {
    const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const now = Date.now();

    const signingKey = new SigningKey({
      kid: `${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${randomHex(4)}`,
      privateJwkJson: JSON.stringify(await exportJWK(privateKey)),
      now,
    });

    await this.signingKeyRepository.insert(signingKey);
    this.logger.log({ kid: signingKey.kid }, 'generate(): Generated the access token signing key');

    return signingKey;
  }

  private parseJwk(json: string): JWK {
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('The stored signing key is not a JWK');
    }

    return { ...parsed };
  }

  private toPublicJwk(signingKey: SigningKey, privateJwk: JWK): IPublicJwk {
    return {
      kty: privateJwk.kty,
      n: privateJwk.n,
      e: privateJwk.e,
      kid: signingKey.kid,
      alg: 'RS256',
      use: 'sig',
      'fxa-createdAt': Math.floor(signingKey.createdAt / 1000),
    };
  }
}
