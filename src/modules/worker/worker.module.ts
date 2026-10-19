import { Module } from '@nestjs/common';
import { SendWorkerService } from './send-worker.service';

@Module({ providers: [SendWorkerService] })
export class WorkerModule {}
