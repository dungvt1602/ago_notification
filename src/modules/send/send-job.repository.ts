/*
 * Tầng truy cập DB của log gửi từng khách (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class SendJobRepository {
  findForLog(since: Date, pendingStatuses: string[], limit: number) {
    return prisma.sendJob.findMany({
      // Tin CHƯA gửi xong thì LUÔN hiện, bất kể ngày tạo.
      where: { OR: [{ createdAt: { gte: since } }, { status: { in: pendingStatuses } }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      // CHỈ lấy cột màn Log gửi thật sự dùng (không kéo `message` toàn văn).
      select: {
        id: true,
        toName: true,
        toPhone: true,
        channel: true,
        status: true,
        messageId: true,
        error: true,
        sentAt: true,
        createdAt: true,
        customer: { select: { company: true } },
        batch: { select: { template: { select: { name: true } } } },
      },
    });
  }

  deleteTerminalBefore(before: Date, terminalStatuses: string[]) {
    return prisma.sendJob.deleteMany({
      where: { createdAt: { lt: before }, status: { in: terminalStatuses } },
    });
  }

  failStalePending(staleBefore: Date, terminalStatuses: string[]) {
    return prisma.sendJob.updateMany({
      where: { createdAt: { lt: staleBefore }, status: { notIn: terminalStatuses } },
      data: {
        status: 'FAILED',
        retryCount: 99, // chặn worker nhặt lại
        error: 'Quá hạn chờ gửi (30 ngày) — chưa từng được gửi.',
      },
    });
  }

  deleteStalePreviewBatches(before: Date) {
    return prisma.sendBatch.deleteMany({
      where: { status: 'PREVIEW', createdAt: { lt: before }, jobs: { none: {} } },
    });
  }
}
