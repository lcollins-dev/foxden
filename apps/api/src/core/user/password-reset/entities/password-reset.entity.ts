import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { User } from '@/core/user/entities/user.entity';

/** A one-time link an admin issues for a forgotten password, stored as the SHA-256 of its token. */
@Entity()
export class PasswordReset {
  constructor(fields: { tokenHash: string; userId: number; expiresAt: number; now: number }) {
    this.tokenHash = fields.tokenHash;
    this.userId = fields.userId;
    this.expiresAt = fields.expiresAt;
    this.createdAt = fields.now;
    this.usedAt = null;
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
  expiresAt: number;

  @Column({ type: 'integer' })
  createdAt: number;

  /** Milliseconds; a used link stays until the purge removes it. */
  @Column({ type: 'integer', nullable: true })
  usedAt: number | null;
}
