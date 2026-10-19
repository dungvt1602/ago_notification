/*
 * Tầng truy cập DB duy nhất của module customers (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

export const customerInclude = {
  templateLinks: { include: { template: { select: { id: true, name: true } } } },
} satisfies Prisma.CustomerInclude;

export type CustomerWithLinks = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

@Injectable()
export class CustomersRepository {
  findManyWithLinks(args: {
    where: Prisma.CustomerWhereInput;
    orderBy: Prisma.CustomerOrderByWithRelationInput[];
    skip?: number;
    take?: number;
  }) {
    return prisma.customer.findMany({ ...args, include: customerInclude });
  }

  count(where: Prisma.CustomerWhereInput) {
    return prisma.customer.count({ where });
  }

  findIds(where: Prisma.CustomerWhereInput) {
    return prisma.customer.findMany({ where, select: { id: true }, orderBy: { name: 'asc' } });
  }

  findTemplateLinks(templateId: bigint, customerIds: bigint[]) {
    return prisma.templateCustomer.findMany({
      where: { templateId, customerId: { in: customerIds } },
      select: { customerId: true },
    });
  }

  findNamesSample(ids: bigint[]) {
    return prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { name: true },
      take: 5,
      orderBy: { name: 'asc' },
    });
  }

  // Huỷ tin chưa gửi + xoá khách CHUNG một transaction (xem chú thích ở service).
  cancelJobsAndDeleteMany(ids: bigint[]) {
    return prisma.$transaction([
      this.cancelPendingJobsOp(ids),
      prisma.customer.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  cancelJobsAndDeleteOne(id: bigint) {
    return prisma.$transaction([this.cancelPendingJobsOp([id]), prisma.customer.delete({ where: { id } })]);
  }

  private cancelPendingJobsOp(ids: bigint[]) {
    return prisma.sendJob.updateMany({
      where: { customerId: { in: ids }, status: { in: ['QUEUED', 'HOLD'] } },
      data: {
        status: 'FAILED',
        retryCount: 99, // chặn worker nhặt lại
        error: 'Khách hàng đã bị xoá — tin chưa gửi đã bị huỷ.',
      },
    });
  }

  findDistinctMarkets() {
    return prisma.customer.findMany({
      where: { market: { not: null } },
      distinct: ['market'],
      select: { market: true },
      orderBy: { market: 'asc' },
    });
  }

  create(data: Prisma.CustomerCreateInput) {
    return prisma.customer.create({ data });
  }

  findExistingByWhatsapp(list: string[]) {
    return prisma.customer.findMany({
      where: { whatsappPhone: { in: list } },
      select: { whatsappPhone: true },
    });
  }

  createMany(data: Prisma.CustomerCreateManyInput[]) {
    return prisma.customer.createMany({ data, skipDuplicates: true });
  }

  findPhoneFields(id: bigint) {
    return prisma.customer.findUnique({
      where: { id },
      select: { whatsappPhone: true, phone: true, market: true },
    });
  }

  update(id: bigint, data: Record<string, unknown>) {
    return prisma.customer.update({ where: { id }, data });
  }

  upsertTemplateLink(key: { templateId: bigint; customerId: bigint }) {
    return prisma.templateCustomer.upsert({
      where: { templateId_customerId: key },
      create: key,
      update: {},
    });
  }

  deleteTemplateLink(templateId: bigint, customerId: bigint) {
    return prisma.templateCustomer.deleteMany({ where: { templateId, customerId } });
  }
}
