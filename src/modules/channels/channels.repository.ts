import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import type { CreateChannelInput } from '@core/validation/channel.schema';

@Injectable()
export class ChannelsRepository {
  findAll() {
    return prisma.channel.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { templates: true, sendBatches: true } } },
    });
  }

  create(input: CreateChannelInput) {
    return prisma.channel.create({
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
    return prisma.channel.update({ where: { id }, data });
  }

  // Gỡ liên kết ở template + lệnh gửi (đặt channelId=null) rồi xóa — cùng một transaction.
  deleteWithRelations(cid: bigint) {
    return prisma.$transaction([
      prisma.template.updateMany({ where: { channelId: cid }, data: { channelId: null } }),
      prisma.sendBatch.updateMany({ where: { channelId: cid }, data: { channelId: null } }),
      prisma.channel.delete({ where: { id: cid } }),
    ]);
  }
}
