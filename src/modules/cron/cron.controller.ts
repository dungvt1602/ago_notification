import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { cleanupSuccessLogs } from '@core/services/activityService';
import { cleanupSendJobs } from '@core/services/sendJobService';
import { cleanupInbound } from '@core/services/inboundService';
import { processNextBatch } from '@core/services/sendService';
import { ensureZaloTokenFresh, zaloStatus } from '@core/services/zaloTokenService';

/*
 * Cổng từ Next: /api/cron/process-sends, /api/cron/zalo-token, /api/cron/cleanup-logs
 * (mỗi route nhận cả GET và POST, lỗi trả 500).
 */
@Controller('cron')
export class CronController {
  // Xử lý hàng đợi gửi kiểu kéo: tối đa ~40s/lần.
  private async processSends() {
    void ensureZaloTokenFresh();
    const startedAt = Date.now();
    const BUDGET_MS = 40_000;
    const results: { code: string; sent: number; failed: number; status: string }[] = [];

    while (Date.now() - startedAt < BUDGET_MS) {
      const r = await processNextBatch();
      if (!r.processed) break; // hết lệnh để gửi
      results.push({ code: r.code, sent: r.sent, failed: r.failed, status: r.finalStatus });
    }

    return { ok: true, batches: results.length, results };
  }

  private async zaloToken() {
    await ensureZaloTokenFresh(true);
    const st = await zaloStatus();
    return { ok: true, connected: st.connected, oaId: st.oaId, expiresAt: st.expiresAt, minutesLeft: st.minutesLeft };
  }

  private async cleanupLogs() {
    const activityDeleted = await cleanupSuccessLogs(3);
    const sendJobsDeleted = await cleanupSendJobs(3);
    const inboundDeleted = await cleanupInbound(3);
    return { ok: true, activityDeleted, sendJobsDeleted, inboundDeleted };
  }

  @Get('process-sends')
  processSendsGet() {
    return handle(() => this.processSends(), 500);
  }

  @Post('process-sends')
  @HttpCode(200)
  processSendsPost() {
    return handle(() => this.processSends(), 500);
  }

  @Get('zalo-token')
  zaloTokenGet() {
    return handle(() => this.zaloToken(), 500);
  }

  @Post('zalo-token')
  @HttpCode(200)
  zaloTokenPost() {
    return handle(() => this.zaloToken(), 500);
  }

  @Get('cleanup-logs')
  cleanupLogsGet() {
    return handle(() => this.cleanupLogs(), 500);
  }

  @Post('cleanup-logs')
  @HttpCode(200)
  cleanupLogsPost() {
    return handle(() => this.cleanupLogs(), 500);
  }
}
