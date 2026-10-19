import { forwardRef, Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { TemplatesRepository } from './templates.repository';
import { MetaSyncService } from './meta-sync.service';
import { MetaSyncRepository } from './meta-sync.repository';

@Module({
  imports: [CustomersModule, forwardRef(() => QuotationsModule)],
  providers: [TemplatesService, TemplatesRepository, MetaSyncService, MetaSyncRepository],
  controllers: [TemplatesController],
  exports: [TemplatesService, MetaSyncService],
})
export class TemplatesModule {}
