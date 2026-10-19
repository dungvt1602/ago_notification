import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import { listSharedZaloBindings } from '@core/lib/zaloSharedToken';

@Injectable()
export class ZaloService {
  // Người đã liên kết Zalo bên worker Go (chế độ dùng chung token), kèm cờ receiveChannel.
  async listSharedUsers() {
    const rows = await listSharedZaloBindings();
    const uids = rows.map((r) => r.zaloUserId).filter(Boolean);
    const channels = uids.length
      ? await prisma.receiveChannel.findMany({
          where: { type: 'ZALO', accountId: { in: uids } },
          select: { accountId: true, name: true, isActive: true },
        })
      : [];
    const byId = new Map(channels.map((c) => [c.accountId, { name: c.name, isActive: c.isActive }]));
    return rows.map((r) => ({ ...r, receiveChannel: byId.get(r.zaloUserId) ?? null }));
  }
}
