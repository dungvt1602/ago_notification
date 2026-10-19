import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class ZaloRepository {
  findChannelsByAccountIds(uids: string[]) {
    return prisma.receiveChannel.findMany({
      where: { type: 'ZALO', accountId: { in: uids } },
      select: { accountId: true, name: true, isActive: true },
    });
  }
}
