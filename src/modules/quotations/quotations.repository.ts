/*
 * Tầng truy cập DB duy nhất của module quotations (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

@Injectable()
export class QuotationsRepository {
  findAllWithTemplateCount() {
    return prisma.quotation.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { templates: true } } },
    });
  }

  findLastCodeByPrefix(prefix: string) {
    return prisma.quotation.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
  }

  create(data: Prisma.QuotationUncheckedCreateInput) {
    return prisma.quotation.create({ data });
  }

  update(id: bigint, data: Prisma.QuotationUncheckedUpdateInput) {
    return prisma.quotation.update({ where: { id }, data });
  }

  findWithItems(id: bigint) {
    return prisma.quotation.findUnique({
      where: { id },
      include: { items: { orderBy: { no: 'asc' } } },
    });
  }

  findDetail(id: bigint) {
    return prisma.quotation.findUnique({
      where: { id },
      include: {
        items: { orderBy: { no: 'asc' } },
        templates: {
          orderBy: { createdAt: 'asc' },
          include: {
            channel: { select: { type: true } },
            _count: { select: { customerLinks: true } },
          },
        },
        _count: { select: { templates: true } },
      },
    });
  }

  countPendingJobs(qid: bigint) {
    return prisma.sendJob.count({
      where: { batch: { quotationId: qid }, status: { in: ['QUEUED', 'SENDING', 'HOLD'] } },
    });
  }

  findBatchIds(qid: bigint) {
    return prisma.sendBatch.findMany({ where: { quotationId: qid }, select: { id: true } });
  }

  // Một transaction, đúng thứ tự mảng cũ (job -> batch -> send log -> gỡ template -> items -> user -> báo giá).
  deleteCascade(qid: bigint, batchIds: bigint[]) {
    return prisma.$transaction([
      ...(batchIds.length ? [prisma.sendJob.deleteMany({ where: { batchId: { in: batchIds } } })] : []),
      prisma.sendBatch.deleteMany({ where: { quotationId: qid } }),
      prisma.quotationTemplateSend.deleteMany({ where: { quotationId: qid } }),
      prisma.template.updateMany({ where: { quotationId: qid }, data: { quotationId: null } }),
      prisma.quotationItem.deleteMany({ where: { quotationId: qid } }),
      prisma.userQuotation.deleteMany({ where: { quotationId: qid } }),
      prisma.quotation.delete({ where: { id: qid } }),
    ]);
  }

  findItems(quotationId: bigint) {
    return prisma.quotationItem.findMany({ where: { quotationId }, orderBy: { no: 'asc' } });
  }

  replaceItems(qid: bigint, items: Prisma.QuotationItemCreateManyInput[], total: number) {
    return prisma.$transaction([
      prisma.quotationItem.deleteMany({ where: { quotationId: qid } }),
      ...(items.length ? [prisma.quotationItem.createMany({ data: items })] : []),
      prisma.quotation.update({ where: { id: qid }, data: { totalAmount: total } }),
    ]);
  }
}
