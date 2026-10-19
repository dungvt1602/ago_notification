import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { getDashboardStats } from '@core/services/dashboardService';

/* Cổng từ Next: GET /api/dashboard. */
@Controller('dashboard')
export class DashboardController {
  @Get()
  get() {
    return handle(() => getDashboardStats(), 500);
  }
}
