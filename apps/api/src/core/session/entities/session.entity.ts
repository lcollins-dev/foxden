import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { User } from '@/core/user/entities/user.entity';

/** A session token, stored as the SHA-256 of its token id since the id alone is a bearer credential. */
@Entity()
export class Session {
  constructor(fields: { tokenIdHash: string; userId: number; userAgent: string | null; now: number }) {
    this.tokenIdHash = fields.tokenIdHash;
    this.userId = fields.userId;
    this.userAgent = fields.userAgent;

    this.createdAt = fields.now;
    this.lastAccessAt = fields.now;
    this.authAt = fields.now;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text', unique: true })
  tokenIdHash: string;

  @Column({ type: 'integer' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer' })
  lastAccessAt: number;

  /** When the password was last checked for this session, in ms; Mozilla's `lastAuthAt`. */
  @Column({ type: 'integer' })
  authAt: number;
}
