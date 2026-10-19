import { Injectable } from '@nestjs/common';
import { ActivityRepository } from './activity.repository';

// Số ngày giữ nhật ký thao tác (thêm/sửa/xoá, đăng nhập...) — mặc định 30, chỉnh bằng ACTIVITY_LOG_DAYS.
export const ACTIVITY_LOG_DAYS = Math.max(1, Number(process.env.ACTIVITY_LOG_DAYS) || 30);
// Hành động ỒN ÀO do hệ thống tự sinh (mỗi lượt gửi / trả lời tự động / gia hạn token) — chỉ giữ 3 ngày.
const NOISY_ACTIONS = ['GUI_WHATSAPP_QUEUE', 'TU_DONG_TRA_LOI', 'ZALO_LAM_MOI_TOKEN', 'ZALO_KIEM_TRA'];

@Injectable()
export class ActivityService {
  constructor(private readonly repo: ActivityRepository) {}

  // Danh sách nhật ký (mới nhất trước) — CHỈ lấy trong `days` ngày gần nhất.
  listActivity(days = ACTIVITY_LOG_DAYS, limit = 3000) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.repo.listSince(since, limit);
  }

  // Dọn nhật ký: (1) log ỒN ÀO thành công cũ hơn `days` ngày (mặc định 3), (2) MỌI log cũ hơn ACTIVITY_LOG_DAYS.
  // Nhật ký thao tác của người dùng (thêm/sửa/xoá...) giữ đủ ACTIVITY_LOG_DAYS để soát "ai đã làm gì".
  async cleanupSuccessLogs(days = 3) {
    const noisyBefore = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const allBefore = new Date(Date.now() - ACTIVITY_LOG_DAYS * 24 * 60 * 60 * 1000);
    const [a, b] = await Promise.all([
      this.repo.deleteNoisyBefore(noisyBefore, NOISY_ACTIONS),
      this.repo.deleteAllBefore(allBefore),
    ]);
    return a.count + b.count;
  }

  // Ghi nhật ký hoạt động (≈ LOG_HOAT_DONG của bot). Không làm hỏng luồng chính nếu lỗi.
  async logActivity(input: {
    userId?: bigint | number | string | null;
    actorName?: string | null;
    action: string;
    target?: string | null;
    result?: string | null;
    note?: string | null;
  }): Promise<void> {
    try {
      await this.repo.create({
        userId: input.userId != null ? BigInt(input.userId) : null,
        actorName: input.actorName ?? null,
        action: input.action,
        target: input.target ?? null,
        result: input.result ?? null,
        note: input.note ?? null,
      });
    } catch {
      // nuốt lỗi ghi log
    }
  }
}
