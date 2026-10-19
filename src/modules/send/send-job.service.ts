import { Injectable } from '@nestjs/common';
import { SendJobRepository } from './send-job.repository';

// Job CHƯA kết thúc — luôn hiện ở listSendJobs.
const PENDING_JOB_STATUS = ['QUEUED', 'SENDING', 'HOLD'] as const;

// Dọn log gửi — CHIA 2 LUẬT để không xoá job CHƯA gửi:
// (1) Job đã KẾT THÚC (SENT/DELIVERED/READ/FAILED) -> xoá sau `days` ngày.
// (2) Job CHƯA kết thúc quá 30 ngày -> đánh FAILED kèm lý do (KHÔNG tự gửi lại), lần dọn sau xoá.
const TERMINAL_JOB_STATUS = ['SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
const STALE_PENDING_DAYS = 30;

@Injectable()
export class SendJobService {
  constructor(private readonly repo: SendJobRepository) {}

  // Danh sách log gửi từng khách (mới nhất trước) — `days` ngày gần nhất, CỘNG THÊM mọi tin chưa gửi xong.
  listSendJobs(days = 3, limit = 3000) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.repo.findForLog(since, [...PENDING_JOB_STATUS], limit);
  }

  async cleanupSendJobs(days = 3) {
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);
    const [deleted, staleFailed] = await Promise.all([
      this.repo.deleteTerminalBefore(before, [...TERMINAL_JOB_STATUS]),
      this.repo.failStalePending(staleBefore, [...TERMINAL_JOB_STATUS]),
    ]);
    return deleted.count + staleFailed.count;
  }

  // Dọn lệnh XEM TRƯỚC bỏ dở. AN TOÀN: chỉ đụng batch PREVIEW KHÔNG CÓ job nào (jobs: none).
  async cleanupStalePreviewBatches(days = 1) {
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const r = await this.repo.deleteStalePreviewBatches(before);
    return r.count;
  }
}
