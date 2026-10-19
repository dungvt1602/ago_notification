import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class NotificationRepository {
  findActiveChannels() {
    return prisma.receiveChannel.findMany({
      where: { isActive: true, type: { in: ['TELEGRAM', 'ZALO'] } },
      select: { name: true, type: true, accountId: true, apiKeyEnv: true },
    });
  }
}
