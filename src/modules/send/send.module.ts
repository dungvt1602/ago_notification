import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module';
import { SendController } from './send.controller';
import { SendService } from './send.service';
import { SendRepository } from './send.repository';
import { SendJobService } from './send-job.service';
import { SendJobRepository } from './send-job.repository';
import { QuotaService } from './quota.service';
import { QuotaRepository } from './quota.repository';

@Module({
  imports: [TemplatesModule],
  providers: [SendService, SendRepository, SendJobService, SendJobRepository, QuotaService, QuotaRepository],
  controllers: [SendController],
  exports: [SendService, SendJobService, QuotaService],
})
export class SendModule {}
