import { Controller, Get, Head, HttpCode } from '@nestjs/common';

/*
 * Cổng từ Next: GET và HEAD /api/health. Endpoint nhẹ cho dịch vụ ping ngoài (UptimeRobot / cron-job.org),
 * KHÔNG đụng DB để luôn trả nhanh.
 */
@Controller('health')
export class HealthController {
  @Get()
  get() {
    return { ok: true, service: 'ago-baogia' };
  }

  @Head()
  @HttpCode(200)
  head(): void {
    return undefined;
  }
}
