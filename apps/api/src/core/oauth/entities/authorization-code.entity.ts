import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { Session } from '@/core/session/entities/session.entity';
import { User } from '@/core/user/entities/user.entity';

@Entity()
export class AuthorizationCode {
  constructor(fields: {
    codeHash: string;
    userId: number;
    sessionId: number;
    clientId: string;
    scope: string;
    keysJwe: string | null;
    codeChallenge: string;
    offline: boolean;
    authAt: number;
    now: number;
  }) {
    this.codeHash = fields.codeHash;
    this.userId = fields.userId;
    this.sessionId = fields.sessionId;
    this.clientId = fields.clientId;
    this.scope = fields.scope;
    this.keysJwe = fields.keysJwe;
    this.codeChallenge = fields.codeChallenge;
    this.offline = fields.offline;
    this.authAt = fields.authAt;
    this.createdAt = fields.now;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text', unique: true })
  codeHash: string;

  @Column({ type: 'integer' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Index()
  @Column({ type: 'integer' })
  sessionId: number;

  @JoinColumn()
  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  session?: Relation<Session>;

  @Column({ type: 'text' })
  clientId: string;

  @Column({ type: 'text' })
  scope: string;

  /** Encrypted to Firefox's ephemeral key by our web UI; opaque to the server. */
  @Column({ type: 'text', nullable: true })
  keysJwe: string | null;

  @Column({ type: 'text' })
  codeChallenge: string;

  @Column({ type: 'boolean' })
  offline: boolean;

  @Column({ type: 'integer' })
  authAt: number;

  @Column({ type: 'integer' })
  createdAt: number;
}
