import { Injectable } from '@nestjs/common';
import { listInbound } from '@core/services/inboundService';

@Injectable()
export class InboundService {
  list() {
    return listInbound();
  }
}
