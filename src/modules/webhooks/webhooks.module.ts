import { Module } from '@nestjs/common';
import { InboundModule } from '../inbound/inbound.module';
import { NotificationModule } from '../notification/notification.module';
import { TemplatesModule } from '../templates/templates.module';
import { ZaloModule } from '../zalo/zalo.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [InboundModule, NotificationModule, TemplatesModule, ZaloModule],
  providers: [WebhooksService],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
