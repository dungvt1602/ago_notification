import { Module } from '@nestjs/common';
import { InboundModule } from '../inbound/inbound.module';
import { SendModule } from '../send/send.module';
import { ZaloModule } from '../zalo/zalo.module';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({
  imports: [SendModule, InboundModule, ZaloModule],
  providers: [CronService],
  controllers: [CronController],
  exports: [CronService],
})
export class CronModule {}
