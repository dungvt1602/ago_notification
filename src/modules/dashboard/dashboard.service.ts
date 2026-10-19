import { Injectable } from '@nestjs/common';
import { getDashboardStats } from '@core/services/dashboardService';

@Injectable()
export class DashboardService {
  stats() {
    return getDashboardStats();
  }
}
