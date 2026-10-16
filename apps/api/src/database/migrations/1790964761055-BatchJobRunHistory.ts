import { MigrationInterface, QueryRunner } from 'typeorm';

export class BatchJobRunHistory1790964761055 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "batch_job_run" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "batchJobId" integer NOT NULL,
        "startDate" datetime NOT NULL,
        "endDate" datetime,
        "result" text NOT NULL,
        "error" text,
        CONSTRAINT "FK_batch_job_run_batch_job" FOREIGN KEY ("batchJobId") REFERENCES "batch_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_batch_job_run_batch_job_id_start_date" ON "batch_job_run" ("batchJobId", "startDate")`
    );
  }

  public async down(): Promise<void> {
    // Not required
  }
}
