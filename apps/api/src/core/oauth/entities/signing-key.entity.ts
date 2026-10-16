import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The RSA key that signs access tokens, generated on first start. */
@Entity()
export class SigningKey {
  constructor(fields: { kid: string; privateJwkJson: string; now: number }) {
    this.kid = fields.kid;
    this.privateJwkJson = fields.privateJwkJson;
    this.createdAt = fields.now;
  }

  @PrimaryColumn({ type: 'text' })
  kid: string;

  @Column({ type: 'text' })
  privateJwkJson: string;

  @Column({ type: 'integer' })
  createdAt: number;
}
