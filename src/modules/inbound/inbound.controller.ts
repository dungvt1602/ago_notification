import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { InboundService } from './inbound.service';

/* Cổng từ Next: GET /api/inbound. */
@Controller('inbound')
export class InboundController {
  constructor(private readonly service: InboundService) {}

  @Get()
  get() {
    return handle(() => this.service.listInbound(), 500);
  }
}
