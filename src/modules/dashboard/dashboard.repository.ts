/*
 * Tầng truy cập DB của trang Tổng quan (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class DashboardRepository {
  countCustomers() {
    return prisma.customer.count();
  }

  countTemplates() {
    return prisma.template.count();
  }

  countChannels() {
    return prisma.channel.count();
  }

  countUsers() {
    return prisma.user.count();
  }

  countActiveCustomers() {
    return prisma.customer.count({ where: { status: 'ACTIVE' } });
  }

  recentActivity() {
    return prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  }

  batchStatusGroups() {
    return prisma.sendBatch.groupBy({ by: ['status'], _count: { _all: true } });
  }

  // Phản hồi gần đây của khách (kèm tên + công ty) — cho sếp xem nhanh.
  recentReplies() {
    return prisma.inboundMessage.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 6,
      include: { customer: { select: { name: true, company: true } } },
    });
  }

  countRepliesSince(since: Date) {
    return prisma.inboundMessage.count({ where: { receivedAt: { gte: since } } });
  }

  // Đếm số khách ĐÃ từng phản hồi (chỉ cần 1 con số, không nạp từng dòng).
  countCustomersReplied() {
    return prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT customer_id) AS count FROM inbound_messages WHERE customer_id IS NOT NULL
    `;
  }
}
