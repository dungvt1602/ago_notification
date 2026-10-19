import { Injectable } from '@nestjs/common';
import { QuotaService } from '../send/quota.service';
import { DashboardRepository } from './dashboard.repository';

// Infinity không JSON hoá được -> null cho client.
const fin = (n: number) => (Number.isFinite(n) ? n : null);

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly quotaService: QuotaService,
  ) {}

  stats() {
    return this.getDashboardStats();
  }

  // Số liệu tổng hợp cho trang Tổng quan.
  async getDashboardStats() {
    const since3d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const [
      customers,
      templates,
      channels,
      users,
      customerActive,
      recentActivity,
      batchGroups,
      recentReplies,
      repliesLast3d,
      customersRepliedRows,
      quota,
    ] = await Promise.all([
      this.repo.countCustomers(),
      this.repo.countTemplates(),
      this.repo.countChannels(),
      this.repo.countUsers(),
      this.repo.countActiveCustomers(),
      this.repo.recentActivity(),
      this.repo.batchStatusGroups(),
      this.repo.recentReplies(),
      this.repo.countRepliesSince(since3d),
      this.repo.countCustomersReplied(),
      // Chất lượng số + hạn mức (Việc 2). KHÔNG ném lỗi (Meta chậm/sập không được làm sập Tổng quan).
      this.quotaService.getQuotaState().catch(() => null),
    ]);

    return {
      counts: { customers, templates, channels, users },
      customerActive,
      recentActivity,
      batchStatus: batchGroups.map((g) => ({ status: g.status, count: g._count._all })),
      recentReplies,
      replyStats: { last3d: repliesLast3d, customersReplied: Number(customersRepliedRows[0]?.count ?? 0) },
      quota: quota
        ? {
            qualityRating: quota.qualityRating,
            tier: quota.tier,
            limit: fin(quota.limit),
            safeLimit: fin(quota.safeLimit),
            used24h: quota.used24h,
            remaining: fin(quota.remaining),
            limitUnknown: quota.limitUnknown,
            // Số có đang gửi được không + số liệu đọc lúc nào (cache 10 phút).
            numberStatus: quota.numberStatus,
            fetchedAt: quota.fetchedAt,
          }
        : null,
    };
  }
}
