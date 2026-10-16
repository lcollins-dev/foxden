import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJob } from './batch-job.entity';

@Entity()
@Index(['batchJobId', 'startDate'])
export class BatchJobRun {
  constructor(fields: { batchJobId: BatchJobId; startDate: Date }) {
    this.batchJobId = fields.batchJobId;

    this.startDate = fields.startDate;
    this.endDate = null;

    this.result = BatchJobRunResult.RUNNING;
    this.error = null;
  }

  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'integer' })
  batchJobId: BatchJobId;

  @JoinColumn()
  @ManyToOne(() => BatchJob, { onDelete: 'CASCADE' })
  batchJob?: Relation<BatchJob>;

  @Column({ type: 'datetime' })
  startDate: Date;

  @Column({ type: 'datetime', nullable: true })
  endDate: Date | null;

  @Column({ type: 'text' })
  result: BatchJobRunResult;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
