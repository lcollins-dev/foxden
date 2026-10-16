import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { User } from './user.entity';

/** A single-use keyFetchToken with the encrypted key bundle `/account/keys` returns. */
@Entity()
export class KeyFetchToken {
  constructor(fields: { tokenIdHash: string; userId: number; bundle: string; now: number }) {
    this.tokenIdHash = fields.tokenIdHash;
    this.userId = fields.userId;
    this.bundle = fields.bundle;
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

  /** hex(ciphertext || mac), encrypted under keys derived from the token seed, which is not stored. */
  @Column({ type: 'text' })
  bundle: string;

  @Column({ type: 'integer' })
  createdAt: number;
}
