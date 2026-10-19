import { Injectable } from '@nestjs/common';
import { cleanupSuccessLogs } from '@core/services/activityService';
import { cleanupSendJobs } from '@core/services/sendJobService';
import { cleanupInbound } from '@core/services/inboundService';
import { processNextBatch } from '@core/services/sendService';
import { ensureZaloTokenFresh, zaloStatus } from '@core/services/zaloTokenService';

@Injectable()
export class CronService {
  // Xử lý hàng đợi gửi kiểu kéo: tối đa ~40s/lần.
  async processSends() {
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

  async zaloToken() {
    await ensureZaloTokenFresh(true);
    const st = await zaloStatus();
    return {
      ok: true,
      connected: st.connected,
      oaId: st.oaId,
      expiresAt: st.expiresAt,
      minutesLeft: st.minutesLeft,
    };
  }

  async cleanupLogs() {
    const activityDeleted = await cleanupSuccessLogs(3);
    const sendJobsDeleted = await cleanupSendJobs(3);
    const inboundDeleted = await cleanupInbound(3);
    return { ok: true, activityDeleted, sendJobsDeleted, inboundDeleted };
  }
}
