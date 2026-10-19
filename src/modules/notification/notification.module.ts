import { Module } from '@nestjs/common';
import { ZaloModule } from '../zalo/zalo.module';
import { NotificationService } from './notification.service';
import { NotificationRepository } from './notification.repository';

@Module({
  imports: [ZaloModule],
  providers: [NotificationService, NotificationRepository],
  exports: [NotificationService],
})
export class NotificationModule {}
