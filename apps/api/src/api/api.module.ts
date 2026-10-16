import { Module } from '@nestjs/common';

import { AvailabilityApiModule } from './v1/availability/availability-api.module';
import { BatchJobApiModule } from './v1/batch-job/batch-job-api.module';
import { InviteApiModule } from './v1/invite/invite-api.module';
import { ServerApiModule } from './v1/server/server-api.module';
import { UserApiModule } from './v1/user/user-api.module';

@Module({
  imports: [AvailabilityApiModule, ServerApiModule, UserApiModule, InviteApiModule, BatchJobApiModule],
})
export class ApiModule {}
