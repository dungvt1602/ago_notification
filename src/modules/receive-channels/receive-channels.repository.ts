import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import type { CreateReceiveChannelInput } from '@core/validation/receiveChannel.schema';

@Injectable()
export class ReceiveChannelsRepository {
  findAll() {
    return prisma.receiveChannel.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { inboundMessages: true } } },
    });
  }

  create(input: CreateReceiveChannelInput) {
    return prisma.receiveChannel.create({
      data: {
        name: input.name,
        type: input.type,
        accountId: input.accountId,
        apiKeyEnv: input.apiKeyEnv,
        note: input.note ?? null,
        ...(input.isActive != null ? { isActive: input.isActive } : {}),
      },
    });
  }

  update(id: bigint, data: Record<string, unknown>) {
    return prisma.receiveChannel.update({ where: { id }, data });
  }

  // Gỡ liên kết ở tin đã nhận (đặt receiveChannelId=null) rồi xóa — cùng một transaction.
  deleteWithRelations(cid: bigint) {
    return prisma.$transaction([
      prisma.inboundMessage.updateMany({
        where: { receiveChannelId: cid },
        data: { receiveChannelId: null },
      }),
      prisma.receiveChannel.delete({ where: { id: cid } }),
    ]);
  }

  findActiveIdByTypeAccount(type: string, accountId: string) {
    return prisma.receiveChannel.findFirst({
      where: { type, accountId, isActive: true },
      select: { id: true },
    });
  }
}
