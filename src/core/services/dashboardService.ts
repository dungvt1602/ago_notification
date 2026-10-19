import { prisma } from "@core/db/prisma";
import { getQuotaState } from "@core/services/quotaService";

// Infinity không JSON hoá được -> null cho client.
const fin = (n: number) => (Number.isFinite(n) ? n : null);

// Số liệu tổng hợp cho trang Tổng quan.
export async function getDashboardStats() {
  const since3d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [
    customers, templates, channels, users,
    customerActive, recentActivity, batchGroups,
    recentReplies, repliesLast3d, customersRepliedRows,
    quota,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.template.count(),
    prisma.channel.count(),
    prisma.user.count(),
    prisma.customer.count({ where: { status: "ACTIVE" } }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.sendBatch.groupBy({ by: ["status"], _count: { _all: true } }),
    // Phản hồi gần đây của khách (kèm tên + công ty) — cho sếp xem nhanh.
    prisma.inboundMessage.findMany({
      orderBy: { receivedAt: "desc" },
      take: 6,
      include: { customer: { select: { name: true, company: true } } },
    }),
    prisma.inboundMessage.count({ where: { receivedAt: { gte: since3d } } }),
    // Đếm số khách ĐÃ từng phản hồi. Trước đây nạp về 1 dòng cho MỖI khách rồi lấy .length —
    // càng nhiều khách phản hồi càng nặng, trong khi chỉ cần đúng một con số.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT customer_id) AS count FROM inbound_messages WHERE customer_id IS NOT NULL
    `,
    // Chất lượng số + hạn mức (Việc 2). KHÔNG ném lỗi (Meta chậm/sập không được làm sập Tổng quan).
    getQuotaState().catch(() => null),
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
          // Số có đang gửi được không + số liệu đọc lúc nào (cache 10'). Thiếu 2 thứ này thì
          // người dùng không thể biết số đã bị Meta khoá, hay mình đang nhìn số liệu cũ.
          numberStatus: quota.numberStatus,
          fetchedAt: quota.fetchedAt,
        }
      : null,
  };
}
