import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';

import { Session } from '@/core/session/entities/session.entity';
import { User } from '@/core/user/entities/user.entity';

/** The record behind an issued JWT, so destroy, verify and profile can revoke it; the JWT itself is not stored. */
@Entity()
export class AccessToken {
  constructor(fields: {
    jti: string;
    userId: number;
    sessionId: number;
    clientId: string;
    scope: string;
    expiresAt: number;
  }) {
    this.jti = fields.jti;
    this.userId = fields.userId;
    this.sessionId = fields.sessionId;
    this.clientId = fields.clientId;
    this.scope = fields.scope;
    this.expiresAt = fields.expiresAt;
  }

  @PrimaryColumn({ type: 'text' })
  jti: string;

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

  @Column({ type: 'integer' })
  expiresAt: number;
}
