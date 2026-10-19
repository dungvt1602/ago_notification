import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class ZaloSenderRepository {
  listRecentInbound() {
    return prisma.inboundMessage.findMany({
      where: { channel: 'ZALO' },
      orderBy: { receivedAt: 'desc' },
      take: 300,
      select: { fromPhone: true, fromName: true, text: true, type: true, receivedAt: true },
    });
  }

  listZaloChannels() {
    return prisma.receiveChannel.findMany({
      where: { type: 'ZALO' },
      select: { accountId: true, name: true, isActive: true },
    });
  }
}
