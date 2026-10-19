import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { listInbound } from '@core/services/inboundService';

/* Cổng từ Next: GET /api/inbound. */
@Controller('inbound')
export class InboundController {
  @Get()
  get() {
    return handle(() => listInbound(), 500);
  }
}
