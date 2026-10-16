import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { User } from './user.entity';

/** A single-use passwordChangeToken, which authorizes `/password/change/finish` for its account. */
@Entity()
export class PasswordChangeToken {
  constructor(fields: { tokenIdHash: string; userId: number; now: number }) {
    this.tokenIdHash = fields.tokenIdHash;
    this.userId = fields.userId;
    this.createdAt = fields.now;
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

  @Column({ type: 'integer' })
  createdAt: number;
}
