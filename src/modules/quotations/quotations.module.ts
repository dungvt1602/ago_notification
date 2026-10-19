import { forwardRef, Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationsRepository } from './quotations.repository';

@Module({
  imports: [forwardRef(() => TemplatesModule)],
  providers: [QuotationsService, QuotationsRepository],
  controllers: [QuotationsController],
  exports: [QuotationsService],
})
export class QuotationsModule {}
