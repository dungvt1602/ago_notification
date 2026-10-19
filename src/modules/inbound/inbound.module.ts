import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { InboundRepository } from './inbound.repository';
import { AutoReplyService } from './auto-reply.service';
import { AutoReplyRepository } from './auto-reply.repository';

@Module({
  imports: [TemplatesModule],
  providers: [InboundService, InboundRepository, AutoReplyService, AutoReplyRepository],
  controllers: [InboundController],
  exports: [InboundService, AutoReplyService],
})
export class InboundModule {}
