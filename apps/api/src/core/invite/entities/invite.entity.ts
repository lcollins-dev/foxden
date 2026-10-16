import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A one-time sign-up link, stored as the SHA-256 of its token. */
@Entity()
export class Invite {
  constructor(fields: {
    tokenHash: string;
    email: string;
    name: string;
    admin: boolean;
    expiresAt: number;
    now: number;
  }) {
    this.tokenHash = fields.tokenHash;
    this.email = fields.email.toLowerCase();
    this.name = fields.name;
    this.admin = fields.admin;
    this.expiresAt = fields.expiresAt;
    this.createdAt = fields.now;
    this.usedAt = null;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text', unique: true })
  tokenHash: string;

  /** Lowercased. */
  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'boolean' })
  admin: boolean;

  @Column({ type: 'integer' })
  expiresAt: number;

  @Column({ type: 'integer' })
  createdAt: number;

  /** Milliseconds; a used invite stays until the purge removes it. */
  @Column({ type: 'integer', nullable: true })
  usedAt: number | null;
}
