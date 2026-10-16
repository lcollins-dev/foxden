import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import {
  BatchJobDto,
  BatchJobListResponseDto,
  BatchJobRunDto,
  BatchJobRunListResponseDto,
  IdParamDto,
  UpdateBatchJobStateRequestDto,
  UserRoleId,
} from '@libs/dto';

import { AllowedRoles } from '@/api/v1/user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { BatchJobAdminService } from './batch-job-admin.service';

@Controller('api/v1/admin/batch-job')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class BatchJobAdminController {
  constructor(private readonly batchJobAdminService: BatchJobAdminService) {}

  @Get('list')
  async getBatchJobList(): Promise<BatchJobListResponseDto> {
    return this.batchJobAdminService.getBatchJobList();
  }

  @Get(':batchJobId')
  async getBatchJob(@Param('batchJobId', new ZodPipe(IdParamDto)) batchJobId: number): Promise<BatchJobDto> {
    return this.batchJobAdminService.getBatchJob(batchJobId);
  }

  @Get(':batchJobId/runs')
  async getBatchJobRunList(
    @Param('batchJobId', new ZodPipe(IdParamDto)) batchJobId: number
  ): Promise<BatchJobRunListResponseDto> {
    return this.batchJobAdminService.getBatchJobRunList(batchJobId);
  }

  @Patch(':batchJobId/state')
  async updateBatchJobState(
    @Param('batchJobId', new ZodPipe(IdParamDto)) batchJobId: number,
    @Body(new ZodPipe(UpdateBatchJobStateRequestDto)) updateBatchJobStateDto: UpdateBatchJobStateRequestDto
  ): Promise<void> {
    return this.batchJobAdminService.updateBatchJobState(batchJobId, updateBatchJobStateDto.enabled);
  }

  @Post(':batchJobId/run')
  @HttpCode(202)
  async runBatchJob(@Param('batchJobId', new ZodPipe(IdParamDto)) batchJobId: number): Promise<BatchJobRunDto> {
    return this.batchJobAdminService.runBatchJob(batchJobId);
  }
}
