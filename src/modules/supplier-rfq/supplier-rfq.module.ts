import { Module } from '@nestjs/common';
import { ZaloModule } from '../zalo/zalo.module';
import { PublicRateLimiter } from './rate-limiter';
import { SupplierRfqController } from './supplier-rfq.controller';
import { SupplierRfqPublicController } from './supplier-rfq-public.controller';
import { SupplierRfqPublicService } from './supplier-rfq-public.service';
import { SupplierRfqRepository } from './supplier-rfq.repository';
import { SupplierRfqSendService } from './supplier-rfq-send.service';
import { SupplierRfqService } from './supplier-rfq.service';

@Module({
  imports: [ZaloModule],
  controllers: [SupplierRfqController, SupplierRfqPublicController],
  providers: [
    SupplierRfqService,
    SupplierRfqSendService,
    SupplierRfqPublicService,
    SupplierRfqRepository,
    PublicRateLimiter,
  ],
})
export class SupplierRfqModule {}
