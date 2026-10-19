import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { CronService } from './cron.service';

/*
 * Cổng từ Next: /api/cron/process-sends, /api/cron/zalo-token, /api/cron/cleanup-logs
 * (mỗi route nhận cả GET và POST, lỗi trả 500).
 */
@Controller('cron')
export class CronController {
  constructor(private readonly service: CronService) {}

  @Get('process-sends')
  processSendsGet() {
    return handle(() => this.service.processSends(), 500);
  }

  @Post('process-sends')
  @HttpCode(200)
  processSendsPost() {
    return handle(() => this.service.processSends(), 500);
  }

  @Get('zalo-token')
  zaloTokenGet() {
    return handle(() => this.service.zaloToken(), 500);
  }

  @Post('zalo-token')
  @HttpCode(200)
  zaloTokenPost() {
    return handle(() => this.service.zaloToken(), 500);
  }

  @Get('cleanup-logs')
  cleanupLogsGet() {
    return handle(() => this.service.cleanupLogs(), 500);
  }

  @Post('cleanup-logs')
  @HttpCode(200)
  cleanupLogsPost() {
    return handle(() => this.service.cleanupLogs(), 500);
  }
}
