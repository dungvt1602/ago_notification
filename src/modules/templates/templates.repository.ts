/*
 * Tầng truy cập DB duy nhất của module templates (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

const listInclude = {
  quotation: { select: { id: true, code: true, title: true } },
  channel: { select: { id: true, name: true, type: true } },
  _count: { select: { customerLinks: true } },
} satisfies Prisma.TemplateInclude;

const linkedInclude = {
  channel: { select: { id: true, name: true, type: true } },
  _count: { select: { customerLinks: true } },
} satisfies Prisma.TemplateInclude;

@Injectable()
export class TemplatesRepository {
  findAll() {
    return prisma.template.findMany({ orderBy: { createdAt: 'desc' }, include: listInclude });
  }

  // 2 truy vấn song song như bản cũ (findMany + count).
  findPaged(where: Prisma.TemplateWhereInput, skip: number, take: number) {
    return Promise.all([
      prisma.template.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: listInclude,
      }),
      prisma.template.count({ where }),
    ]);
  }

  findDetail(id: bigint) {
    return prisma.template.findUnique({
      where: { id },
      include: {
        // Kèm mặt hàng + số template đang dùng chung: trang chi tiết template quản lý luôn báo giá.
        quotation: {
          select: {
            id: true,
            code: true,
            title: true,
            market: true,
            currency: true,
            totalAmount: true,
            status: true,
            validUntil: true,
            issuedDate: true,
            items: {
              orderBy: { no: 'asc' },
              select: {
                id: true,
                no: true,
                product: true,
                packing: true,
                unit: true,
                quantity: true,
                price: true,
              },
            },
            _count: { select: { templates: true } },
          },
        },
        channel: { select: { id: true, name: true, type: true, accountId: true } },
        image: { select: { mime: true, updatedAt: true } }, // chỉ lấy metadata, KHÔNG lấy bytes
        _count: { select: { customerLinks: true } },
      },
    });
  }

  // ---- Ảnh header ----

  findImageMeta(templateId: bigint) {
    return prisma.templateImage.findUnique({
      where: { templateId },
      select: { mime: true, storagePath: true, updatedAt: true },
    });
  }

  findImageFull(templateId: bigint) {
    return prisma.templateImage.findUnique({ where: { templateId } });
  }

  findImageMime(templateId: bigint) {
    return prisma.templateImage.findUnique({ where: { templateId }, select: { mime: true } });
  }

  findImageStoragePath(templateId: bigint) {
    return prisma.templateImage.findUnique({ where: { templateId }, select: { storagePath: true } });
  }

  upsertImageStorage(templateId: bigint, path: string, mime: string) {
    return prisma.templateImage.upsert({
      where: { templateId },
      create: { templateId, data: null, storagePath: path, mime },
      update: { data: null, storagePath: path, mime },
    });
  }

  upsertImageBytes(templateId: bigint, bytes: Uint8Array<ArrayBuffer>, mime: string) {
    return prisma.templateImage.upsert({
      where: { templateId },
      create: { templateId, data: bytes, mime },
      update: { data: bytes, mime },
    });
  }

  deleteImages(templateId: bigint) {
    return prisma.templateImage.deleteMany({ where: { templateId } });
  }

  // ---- Template ----

  findByQuotation(quotationId: bigint) {
    return prisma.template.findMany({
      where: { quotationId },
      orderBy: { createdAt: 'asc' },
      include: linkedInclude,
    });
  }

  findPool() {
    return prisma.template.findMany({
      where: { quotationId: null },
      orderBy: { createdAt: 'desc' },
      include: linkedInclude,
    });
  }

  create(data: Prisma.TemplateUncheckedCreateInput) {
    return prisma.template.create({ data });
  }

  update(id: bigint, data: Prisma.TemplateUncheckedUpdateInput) {
    return prisma.template.update({ where: { id }, data });
  }

  // Bật trả lời tự động cho 1 mẫu -> TẮT mọi mẫu khác trong cùng transaction.
  updateExclusiveAutoReply(id: bigint, data: Prisma.TemplateUncheckedUpdateInput) {
    return prisma.$transaction(async (tx) => {
      await tx.template.updateMany({
        where: { id: { not: id }, autoReply: true },
        data: { autoReply: false },
      });
      return tx.template.update({ where: { id }, data });
    });
  }

  countPendingJobs(templateId: bigint) {
    return prisma.sendJob.count({
      where: { batch: { templateId }, status: { in: ['QUEUED', 'SENDING', 'HOLD'] } },
    });
  }

  deleteCascade(tid: bigint) {
    return prisma.$transaction([
      prisma.quotationTemplateSend.deleteMany({ where: { templateId: tid } }),
      prisma.sendBatch.deleteMany({ where: { templateId: tid } }),
      prisma.template.delete({ where: { id: tid } }),
    ]);
  }

  // ---- Link khách ----

  unlinkCustomers(templateId: bigint, customerIds: bigint[]) {
    return prisma.templateCustomer.deleteMany({ where: { templateId, customerId: { in: customerIds } } });
  }

  linkCustomers(data: { templateId: bigint; customerId: bigint }[]) {
    return prisma.templateCustomer.createMany({ data, skipDuplicates: true });
  }

  findLinksWithCustomer(templateId: bigint) {
    return prisma.templateCustomer.findMany({
      where: { templateId },
      orderBy: { createdAt: 'asc' },
      include: { customer: true },
    });
  }
}
