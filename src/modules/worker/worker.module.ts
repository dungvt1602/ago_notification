import { Module } from '@nestjs/common';
import { InboundModule } from '../inbound/inbound.module';
import { SendModule } from '../send/send.module';
import { ZaloModule } from '../zalo/zalo.module';
import { SendWorkerService } from './send-worker.service';

@Module({ imports: [SendModule, InboundModule, ZaloModule], providers: [SendWorkerService] })
export class WorkerModule {}
