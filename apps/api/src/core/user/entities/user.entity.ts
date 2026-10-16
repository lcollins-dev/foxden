import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  OneToMany,
  type Relation,
} from 'typeorm';

import { UserUserRole } from './user-user-role.entity';

export interface IOnepwCredentials {
  authSalt: string;
  verifyHash: string;
  wrapWrapKb: string;
  clientSalt: string;
}

/**
 * A Firefox account. Hex columns hold the onepw values Mozilla's auth server stores at sign-up
 * (`fxa-auth-server/lib/crypto/password.js`, `lib/routes/account.ts` `createAccount`), the v2 ones under the plain
 * names.
 */
@Entity()
export class User {
  constructor(fields: {
    uid: string;
    name: string;
    email: string;
    locale: string | null;
    kA: string;
    credentials: IOnepwCredentials;
    now: number;
    mustChangePassword?: boolean;
  }) {
    this.uid = fields.uid;
    this.name = fields.name;
    this.email = fields.email;
    this.normalizedEmail = fields.email.toLowerCase();
    this.locale = fields.locale;

    this.authSalt = fields.credentials.authSalt;
    this.verifyHash = fields.credentials.verifyHash;
    this.wrapWrapKb = fields.credentials.wrapWrapKb;
    this.clientSalt = fields.credentials.clientSalt;
    this.kA = fields.kA;

    this.verifierSetAt = fields.now;
    this.keysChangedAt = fields.now;

    this.enabled = true;
    this.mustChangePassword = fields.mustChangePassword ?? false;

    this.lastLoginSuccess = null;
    this.lastLoginFail = null;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  /** 32 lowercase hex characters; the `sub` of every access token. */
  @Column({ type: 'text', unique: true })
  uid: string;

  @Column({ type: 'text' })
  name: string;

  /** As typed at sign-up. */
  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text', unique: true })
  normalizedEmail: string;

  @Column({ type: 'text', nullable: true })
  locale: string | null;

  @Column({ type: 'text' })
  authSalt: string;

  /** Checks a v2 authPW; this server stores no v1 verifier. */
  @Column({ type: 'text' })
  verifyHash: string;

  @Column({ type: 'text' })
  wrapWrapKb: string;

  @Column({ type: 'text' })
  clientSalt: string;

  @Column({ type: 'text' })
  kA: string;

  /** Milliseconds; the `fxa-generation` claim, which only moves forward. */
  @Column({ type: 'integer' })
  verifierSetAt: number;

  /** Milliseconds, never 0: the Sync kid prefix and `keyRotationTimestamp`. */
  @Column({ type: 'integer' })
  keysChangedAt: number;

  @Column({ type: 'boolean' })
  enabled: boolean;

  /** Holds the account to first-time setup; only a password change clears it. */
  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastLoginSuccess: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastLoginFail: Date | null;

  @UpdateDateColumn({ type: 'datetime' })
  lastAccess!: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdDate!: Date;

  @OneToMany(() => UserUserRole, userUserRole => userUserRole.user)
  userUserRoles?: Relation<UserUserRole[]>;
}
