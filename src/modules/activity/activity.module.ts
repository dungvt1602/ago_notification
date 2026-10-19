import { Global, Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';
import { ActivityService } from './activity.service';

// Global: mọi service cần ghi nhật ký (logActivity) tự inject ActivityService, không phải import module.
@Global()
@Module({
  providers: [ActivityService, ActivityRepository],
  controllers: [ActivityController],
  exports: [ActivityService],
})
export class ActivityModule {}
