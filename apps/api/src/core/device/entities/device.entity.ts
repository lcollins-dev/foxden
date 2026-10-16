import { Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryColumn, type Relation } from 'typeorm';

import { Session } from '@/core/session/entities/session.entity';
import { User } from '@/core/user/entities/user.entity';

export interface IDevicePush {
  pushCallback: string;
  pushPublicKey: string;
  pushAuthKey: string;
}

/** A registered device, one per session; push fields and commands are echoed back exactly as registered. */
@Entity()
export class Device {
  constructor(fields: { id: string; userId: number; sessionId: number; now: number }) {
    this.id = fields.id;
    this.userId = fields.userId;
    this.sessionId = fields.sessionId;

    this.name = '';
    this.type = 'desktop';

    this.pushCallback = null;
    this.pushPublicKey = null;
    this.pushAuthKey = null;
    this.pushEndpointExpired = false;

    this.availableCommandsJson = '{}';

    this.createdAt = fields.now;
    this.lastAccessAt = fields.now;
  }

  /** 32 hex characters. */
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'integer' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user?: Relation<User>;

  @Column({ type: 'integer', nullable: true })
  sessionId: number | null;

  @JoinColumn()
  @OneToOne(() => Session, { onDelete: 'CASCADE' })
  session?: Relation<Session>;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text', nullable: true })
  pushCallback: string | null;

  @Column({ type: 'text', nullable: true })
  pushPublicKey: string | null;

  @Column({ type: 'text', nullable: true })
  pushAuthKey: string | null;

  @Column({ type: 'boolean' })
  pushEndpointExpired: boolean;

  /** Command name to opaque JSON string, stored byte for byte. */
  @Column({ type: 'text' })
  availableCommandsJson: string;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer' })
  lastAccessAt: number;
}
