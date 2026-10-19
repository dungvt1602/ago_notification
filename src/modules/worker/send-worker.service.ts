import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { isDryRun } from '@core/lib/whatsapp';
import { processNextBatch } from '@core/services/sendService';
import { cleanupSuccessLogs } from '@core/services/activityService';
import { cleanupSendJobs, cleanupStalePreviewBatches } from '@core/services/sendJobService';
import { cleanupInbound } from '@core/services/inboundService';
import { ensureZaloTokenFresh } from '@core/services/zaloTokenService';

/*
 * Worker nền chạy cùng tiến trình API (port nguyên từ src/instrumentation.ts của bản Next):
 * poll gửi báo giá, dọn log mỗi 10 phút, làm mới token Zalo mỗi 5 phút. Logic + điều kiện bỏ qua giữ nguyên.
 */
@Injectable()
export class SendWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('SendWorker');
  private timers: NodeJS.Timeout[] = [];

  onApplicationBootstrap(): void {
    if (process.env.SEND_WORKER_DISABLED === 'true') return;

    // Bỏ qua nếu chưa cấu hình DB thật (tránh spam lỗi khi DATABASE_URL còn placeholder).
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl || dbUrl.includes('placeholder') || dbUrl.includes('[PROJECT-REF]')) {
      this.log.warn('[sendWorker] Bỏ qua: DATABASE_URL chưa cấu hình thật.');
      return;
    }

    // NÓI TO chế độ gửi ngay lúc khởi động (gửi giả vẫn đánh "Đã gửi" nên phải thấy được trong log).
    if (isDryRun()) {
      this.log.warn(
        `[sendWorker] ⚠️  CHẾ ĐỘ GỬI GIẢ (SEND_DRY_RUN=${JSON.stringify(process.env.SEND_DRY_RUN ?? '')}). ` +
          `KHÔNG có tin nào được gửi tới khách, nhưng log vẫn hiện "Đã gửi". Đặt SEND_DRY_RUN=false để gửi thật.`,
      );
    } else {
      this.log.log('[sendWorker] Chế độ GỬI THẬT — tin sẽ được gửi tới khách hàng.');
    }

    const pollMs = Number(process.env.SEND_WORKER_POLL_MS || 8000);
    let running = false;
    this.timers.push(
      setInterval(() => {
        if (running) return;
        running = true;
        processNextBatch()
          .catch((err) =>
            this.log.error(`[sendWorker] error: ${err instanceof Error ? err.stack : String(err)}`),
          )
          .finally(() => {
            running = false;
          });
      }, pollMs),
    );
    this.log.log(`[sendWorker] started, poll ${pollMs}ms`);

    // Dọn định kỳ mỗi 10 PHÚT: log/phản hồi/job quá 3 ngày, lệnh xem trước bỏ dở quá 1 ngày.
    let cleaning = false;
    const runCleanup = async () => {
      if (cleaning) return;
      cleaning = true;
      try {
        const a = await cleanupSuccessLogs(3);
        const b = await cleanupSendJobs(3);
        const c = await cleanupInbound(3);
        const d = await cleanupStalePreviewBatches(1);
        if (a || b || c || d) {
          this.log.log(`[logCleanup] xóa -> activity:${a} send_jobs:${b} inbound:${c} preview_bo_do:${d}`);
        }
      } catch (err) {
        this.log.error(`[logCleanup] error: ${err instanceof Error ? err.stack : String(err)}`);
      } finally {
        cleaning = false;
      }
    };
    this.timers.push(setInterval(() => void runCleanup(), 10 * 60 * 1000));
    this.log.log('[logCleanup] chạy mỗi 10 phút (xóa >3 ngày)');

    // Làm mới token Zalo OA mỗi 5 PHÚT (còn < 10 phút thì đổi refresh_token lấy cặp mới).
    void ensureZaloTokenFresh(true);
    this.timers.push(setInterval(() => void ensureZaloTokenFresh(true), 5 * 60 * 1000));
    this.log.log('[zaloToken] job làm mới token Zalo OA chạy mỗi 5 phút');
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
  }
}
