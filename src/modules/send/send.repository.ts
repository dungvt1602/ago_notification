/*
 * Tầng truy cập DB duy nhất của luồng gửi (Prisma). Không chứa logic nghiệp vụ —
 * mỗi hàm là đúng 1 câu truy vấn như bản gốc, thứ tự/điều kiện giữ nguyên.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

const batchListInclude = {
  quotation: { select: { code: true, title: true } },
  template: { select: { name: true } },
  channel: { select: { name: true, type: true } },
  _count: { select: { jobs: true } },
} satisfies Prisma.SendBatchInclude;

@Injectable()
export class SendRepository {
  // ---- Truy vấn lệnh gửi ----
  findBatches() {
    return prisma.sendBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: batchListInclude,
    });
  }

  findBatchWithJobs(id: bigint) {
    return prisma.sendBatch.findUnique({
      where: { id },
      include: {
        quotation: { select: { code: true, title: true } },
        template: { select: { name: true } },
        channel: { select: { name: true, type: true } },
        jobs: { orderBy: { id: 'asc' } },
      },
    });
  }

  // ---- Preview ----
  findTemplateForPreview(id: bigint) {
    return prisma.template.findUnique({
      where: { id },
      include: {
        quotation: { include: { items: { orderBy: { no: 'asc' } } } },
        channel: true,
        customerLinks: { include: { customer: true } },
      },
    });
  }

  findChannel(id: bigint) {
    return prisma.channel.findUnique({ where: { id } });
  }

  createBatch(data: Prisma.SendBatchUncheckedCreateInput) {
    return prisma.sendBatch.create({ data });
  }

  countWaJobsPending() {
    return prisma.sendJob.count({
      where: { channel: 'WHATSAPP', status: { in: ['QUEUED', 'SENDING', 'HOLD'] } },
    });
  }

  // ---- Confirm ----
  findBatchForConfirm(id: bigint) {
    return prisma.sendBatch.findUnique({
      where: { id },
      include: {
        channel: true,
        template: {
          include: {
            quotation: { include: { items: { orderBy: { no: 'asc' } } } },
            channel: true,
            customerLinks: { include: { customer: true } },
          },
        },
      },
    });
  }

  // Khoá lệnh bằng UPDATE có điều kiện PREVIEW -> QUEUED (chặn bấm xác nhận 2 lần).
  lockPreviewBatch(id: bigint) {
    return prisma.sendBatch.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'QUEUED' } });
  }

  createJobs(data: Prisma.SendJobCreateManyInput[]) {
    return prisma.sendJob.createMany({
      data,
      skipDuplicates: true, // chốt chặn cuối: unique (batch_id, customer_id)
    });
  }

  revertBatchToPreview(id: bigint) {
    return prisma.sendBatch.update({ where: { id }, data: { status: 'PREVIEW' } });
  }

  markBatchQueued(id: bigint, note: string) {
    return prisma.sendBatch.update({ where: { id }, data: { status: 'QUEUED', note } });
  }

  // ---- Cancel: 1 $transaction dạng mảng (huỷ job chưa gửi + đổi batch) ----
  cancelBatchTransaction(id: bigint, maxRetry: number) {
    return prisma.$transaction([
      prisma.sendJob.updateMany({
        where: { batchId: id, status: { in: ['QUEUED', 'HOLD'] } },
        data: {
          status: 'FAILED',
          retryCount: maxRetry,
          error: 'Lệnh đã bị huỷ bởi người dùng.',
        },
      }),
      prisma.sendBatch.update({
        where: { id },
        data: { status: 'CANCELLED', note: 'Người dùng đã hủy lệnh.' },
      }),
    ]);
  }

  // ---- Worker ----
  failStuckSending(before: Date, maxRetry: number, error: string) {
    return prisma.sendJob.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: before } },
      data: { status: 'FAILED', retryCount: maxRetry, error },
    });
  }

  findHoldIdsFifo(take: number) {
    return prisma.sendJob.findMany({
      where: { status: 'HOLD', channel: 'WHATSAPP' },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    });
  }

  queueJobsByIds(ids: bigint[]) {
    return prisma.sendJob.updateMany({ where: { id: { in: ids } }, data: { status: 'QUEUED' } });
  }

  holdRetryableOfBatch(batchId: bigint, maxRetry: number) {
    return prisma.sendJob.updateMany({
      where: { batchId, OR: [{ status: 'QUEUED' }, { status: 'FAILED', retryCount: { lt: maxRetry } }] },
      data: { status: 'HOLD' },
    });
  }

  findFirstWaJobByStatus(status: 'QUEUED' | 'HOLD') {
    return prisma.sendJob.findFirst({ where: { status, channel: 'WHATSAPP' }, select: { id: true } });
  }

  holdAllQueuedWa() {
    return prisma.sendJob.updateMany({
      where: { status: 'QUEUED', channel: 'WHATSAPP' },
      data: { status: 'HOLD' },
    });
  }

  findNextJob(maxRetry: number) {
    return prisma.sendJob.findFirst({
      where: {
        OR: [{ status: 'QUEUED' }, { status: 'FAILED', retryCount: { lt: maxRetry } }],
      },
      orderBy: { id: 'asc' },
    });
  }

  findBatchForSending(id: bigint) {
    return prisma.sendBatch.findUnique({
      where: { id },
      include: {
        channel: true,
        template: {
          include: { channel: true, quotation: { include: { items: { orderBy: { no: 'asc' } } } } },
        },
      },
    });
  }

  markBatchSending(id: bigint) {
    return prisma.sendBatch.update({ where: { id }, data: { status: 'SENDING' } });
  }

  saveBatchMediaId(id: bigint, mediaId: string) {
    return prisma.sendBatch.update({ where: { id }, data: { mediaId } });
  }

  failRetryableOfBatch(batchId: bigint, maxRetry: number, error: string) {
    return prisma.sendJob.updateMany({
      where: { batchId, OR: [{ status: 'QUEUED' }, { status: 'FAILED', retryCount: { lt: maxRetry } }] },
      data: { status: 'FAILED', error, retryCount: maxRetry },
    });
  }

  markBatchPartialFailed(id: bigint, note: string) {
    return prisma.sendBatch.update({ where: { id }, data: { status: 'PARTIAL_FAILED', note } });
  }

  findRetryableJobsOfBatch(batchId: bigint, maxRetry: number) {
    return prisma.sendJob.findMany({
      where: {
        batchId,
        OR: [{ status: 'QUEUED' }, { status: 'FAILED', retryCount: { lt: maxRetry } }],
      },
      orderBy: { id: 'asc' },
    });
  }

  // GIỮ CHỖ tin trước khi gửi (chỉ tiến trình đổi được trạng thái count=1 mới gửi -> không gửi trùng).
  claimJob(id: bigint, maxRetry: number) {
    return prisma.sendJob.updateMany({
      where: { id, OR: [{ status: 'QUEUED' }, { status: 'FAILED', retryCount: { lt: maxRetry } }] },
      data: { status: 'SENDING' },
    });
  }

  failJobNoPhone(id: bigint, retryCount: number) {
    return prisma.sendJob.update({
      where: { id },
      data: { status: 'FAILED', error: 'Thiếu số điện thoại.', retryCount },
    });
  }

  markJobSent(id: bigint, messageId: string | null | undefined) {
    return prisma.sendJob.update({
      where: { id },
      data: { status: 'SENT', messageId, error: null, sentAt: new Date() },
    });
  }

  // Có throw (không .catch) — chỉ gọi ngoài; việc .catch(() => {}) do service giữ như bản gốc.
  markCustomerNoWhatsapp(customerId: bigint) {
    return prisma.customer.update({ where: { id: customerId }, data: { waStatus: 'NO_WHATSAPP' } });
  }

  updateJobAfterError(id: bigint, data: { status: string; error: string; retryCount: number }) {
    return prisma.sendJob.update({ where: { id }, data });
  }

  countJobsOfBatchByStatuses(batchId: bigint, statuses: string[]) {
    return prisma.sendJob.count({ where: { batchId, status: { in: statuses } } });
  }

  countJobsOfBatchByStatus(batchId: bigint, status: string) {
    return prisma.sendJob.count({ where: { batchId, status } });
  }

  finishBatch(id: bigint, status: string, note: string) {
    return prisma.sendBatch.update({ where: { id }, data: { status, note } });
  }
}
