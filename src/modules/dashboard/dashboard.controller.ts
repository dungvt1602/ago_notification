import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { DashboardService } from './dashboard.service';

/* Cổng từ Next: GET /api/dashboard. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  get() {
    return handle(() => this.service.stats(), 500);
  }
}
