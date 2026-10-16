import { Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { Session } from '@/core/session/entities/session.entity';
import { User } from '@/core/user/entities/user.entity';

@Entity()
export class RefreshToken {
  constructor(fields: {
    tokenHash: string;
    userId: number;
    sessionId: number;
    clientId: string;
    scope: string;
    now: number;
  }) {
    this.tokenHash = fields.tokenHash;
    this.userId = fields.userId;
    this.sessionId = fields.sessionId;
    this.clientId = fields.clientId;
    this.scope = fields.scope;
    this.createdAt = fields.now;
    this.lastUsedAt = fields.now;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text', unique: true })
  tokenHash: string;

  @Column({ type: 'integer' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Column({ type: 'integer' })
  sessionId: number;

  @JoinColumn()
  @OneToOne(() => Session, { onDelete: 'CASCADE' })
  session?: Relation<Session>;

  @Column({ type: 'text' })
  clientId: string;

  @Column({ type: 'text' })
  scope: string;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer' })
  lastUsedAt: number;
}
