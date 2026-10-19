import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

/* Truy cập DB cho nhật ký hoạt động (activity_logs). Câu truy vấn giữ nguyên từ activityService gốc. */
@Injectable()
export class ActivityRepository {
  listSince(since: Date, limit: number) {
    return prisma.activityLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  deleteNoisyBefore(before: Date, actions: string[]) {
    return prisma.activityLog.deleteMany({
      where: { createdAt: { lt: before }, result: 'SUCCESS', action: { in: actions } },
    });
  }

  deleteAllBefore(before: Date) {
    return prisma.activityLog.deleteMany({ where: { createdAt: { lt: before } } });
  }

  create(data: {
    userId: bigint | null;
    actorName: string | null;
    action: string;
    target: string | null;
    result: string | null;
    note: string | null;
  }) {
    return prisma.activityLog.create({ data });
  }
}
