import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit/audit.module';
import { CommonModule } from './common/common.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { CronModule } from './modules/cron/cron.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { InboundModule } from './modules/inbound/inbound.module';
import { NotificationModule } from './modules/notification/notification.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { ReceiveChannelsModule } from './modules/receive-channels/receive-channels.module';
import { SendModule } from './modules/send/send.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkerModule } from './modules/worker/worker.module';
import { ZaloModule } from './modules/zalo/zalo.module';

/*
 * Gốc ứng dụng. Mỗi module = 1 nhóm route của bản Next (src/app/api/*); logic nghiệp vụ nằm ở src/core
 * (copy nguyên văn từ src/server), controller chỉ là lớp HTTP mỏng.
 */
@Module({
  imports: [
    CommonModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ChannelsModule,
    ReceiveChannelsModule,
    CustomersModule,
    QuotationsModule,
    TemplatesModule,
    SendModule,
    ActivityModule,
    InboundModule,
    NotificationModule,
    DashboardModule,
    HealthModule,
    CronModule,
    WebhooksModule,
    ZaloModule,
    WorkerModule,
  ],
})
export class AppModule {}
