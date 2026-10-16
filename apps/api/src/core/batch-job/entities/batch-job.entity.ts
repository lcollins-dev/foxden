import { Column, Entity, PrimaryColumn } from 'typeorm';

import { BatchJobId } from '@libs/dto';

@Entity()
export class BatchJob {
  constructor(fields: { id: BatchJobId; name: string; desc: string; enabled: boolean }) {
    this.id = fields.id;

    this.name = fields.name;
    this.desc = fields.desc;

    this.cronExpression = null;

    this.enabled = fields.enabled;

    this.lastStartDate = null;
    this.lastSuccessDate = null;
    this.lastFailDate = null;
  }

  @PrimaryColumn({ type: 'integer' })
  id: BatchJobId;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  desc: string;

  @Column({ type: 'text', nullable: true })
  cronExpression: string | null;

  @Column({ type: 'boolean' })
  enabled: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastStartDate: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSuccessDate: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastFailDate: Date | null;
}
