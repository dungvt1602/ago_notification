/*
 * Tầng truy cập DB duy nhất của luồng phản hồi khách (inbound_messages + liên quan). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

type InboundCreateData = Parameters<typeof prisma.inboundMessage.create>[0]['data'];

@Injectable()
export class InboundRepository {
  findAllCustomerPhones() {
    return prisma.customer.findMany({
      select: { id: true, whatsappPhone: true, phone: true },
    });
  }

  // Trả bản ghi vừa tạo (kèm tên/công ty khách) để báo sếp.
  createInbound(data: InboundCreateData) {
    return prisma.inboundMessage.create({
      data,
      include: { customer: { select: { name: true, company: true, market: true } } },
    });
  }

  updateJobsByMessageId(waMessageId: string, data: { status: string; retryCount?: number; error?: string }) {
    return prisma.sendJob.updateMany({
      where: { messageId: waMessageId },
      data,
    });
  }

  findRecent(limit: number) {
    return prisma.inboundMessage.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { name: true, company: true } },
        receiveChannel: { select: { name: true, type: true } },
      },
    });
  }

  deleteBefore(before: Date) {
    return prisma.inboundMessage.deleteMany({
      where: { receivedAt: { lt: before } },
    });
  }

  countAll() {
    return prisma.inboundMessage.count();
  }

  countSince(since: Date) {
    return prisma.inboundMessage.count({ where: { receivedAt: { gte: since } } });
  }

  findDistinctCustomers() {
    return prisma.inboundMessage.findMany({
      where: { customerId: { not: null } },
      distinct: ['customerId'],
      select: { customerId: true },
    });
  }
}
