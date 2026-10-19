import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import type { Model } from './audit.helpers';

/* Đọc bản ghi TRƯỚC khi sửa/xoá để ghi diff — câu truy vấn giữ nguyên từ auditService.snapshot gốc. */
@Injectable()
export class AuditRepository {
  findBefore(model: Model, id: string): Promise<Record<string, unknown> | null> | null {
    const where = { id: BigInt(id) };
    switch (model) {
      case 'customer':
        return prisma.customer.findUnique({ where });
      case 'template':
        return prisma.template.findUnique({ where });
      case 'quotation':
        return prisma.quotation.findUnique({ where });
      case 'user':
        return prisma.user.findUnique({
          where,
          select: { id: true, username: true, email: true, fullName: true, isActive: true },
        });
      case 'channel':
        return prisma.channel.findUnique({ where });
      case 'receiveChannel':
        return prisma.receiveChannel.findUnique({ where });
    }
  }
}
