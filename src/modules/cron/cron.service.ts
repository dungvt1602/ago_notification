import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { InboundService } from '../inbound/inbound.service';
import { SendJobService } from '../send/send-job.service';
import { SendService } from '../send/send.service';
import { ZaloTokenService } from '../zalo/zalo-token.service';

@Injectable()
export class CronService {
  constructor(
    private readonly activity: ActivityService,
    private readonly inbound: InboundService,
    private readonly sendJobs: SendJobService,
    private readonly send: SendService,
    private readonly zaloTokenSvc: ZaloTokenService,
  ) {}

  // Xử lý hàng đợi gửi kiểu kéo: tối đa ~40s/lần.
  async processSends() {
    void this.zaloTokenSvc.ensureZaloTokenFresh();
    const startedAt = Date.now();
    const BUDGET_MS = 40_000;
    const results: { code: string; sent: number; failed: number; status: string }[] = [];

    while (Date.now() - startedAt < BUDGET_MS) {
      const r = await this.send.processNextBatch();
      if (!r.processed) break; // hết lệnh để gửi
      results.push({ code: r.code, sent: r.sent, failed: r.failed, status: r.finalStatus });
    }

    return { ok: true, batches: results.length, results };
  }

  async zaloToken() {
    await this.zaloTokenSvc.ensureZaloTokenFresh(true);
    const st = await this.zaloTokenSvc.zaloStatus();
    return {
      ok: true,
      connected: st.connected,
      oaId: st.oaId,
      expiresAt: st.expiresAt,
      minutesLeft: st.minutesLeft,
    };
  }

  async cleanupLogs() {
    const activityDeleted = await this.activity.cleanupSuccessLogs(3);
    const sendJobsDeleted = await this.sendJobs.cleanupSendJobs(3);
    const inboundDeleted = await this.inbound.cleanupInbound(3);
    return { ok: true, activityDeleted, sendJobsDeleted, inboundDeleted };
  }
}
