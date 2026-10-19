import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class ZaloLinkRepository {
  findUser(uid: bigint) {
    return prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, username: true, fullName: true },
    });
  }

  deleteExpiredRequests() {
    return prisma.zaloLinkRequest.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  findRequestClash(code: string) {
    return prisma.zaloLinkRequest.findUnique({ where: { code }, select: { userId: true } });
  }

  upsertRequest(uid: bigint, code: string, expiresAt: Date) {
    return prisma.zaloLinkRequest.upsert({
      where: { userId: uid },
      create: { userId: uid, code, expiresAt },
      update: { code, expiresAt },
    });
  }

  findBindingByUser(uid: bigint) {
    return prisma.zaloUserBinding.findUnique({ where: { userId: uid } });
  }

  findRequestByUser(uid: bigint) {
    return prisma.zaloLinkRequest.findUnique({ where: { userId: uid } });
  }

  deleteRequestsByUser(uid: bigint) {
    return prisma.zaloLinkRequest.deleteMany({ where: { userId: uid } });
  }

  // Xoá kênh nhận ZALO + binding trong 1 transaction.
  removeBindingAndChannel(uid: bigint, zaloUserId: string) {
    return prisma.$transaction([
      prisma.receiveChannel.deleteMany({ where: { type: 'ZALO', accountId: zaloUserId } }),
      prisma.zaloUserBinding.delete({ where: { userId: uid } }),
    ]);
  }

  findRequestByCode(code: string) {
    return prisma.zaloLinkRequest.findUnique({
      where: { code },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    });
  }

  deleteRequest(userId: bigint) {
    return prisma.zaloLinkRequest.delete({ where: { userId } });
  }

  // Gắn Zalo: gỡ binding cũ, upsert binding + kênh nhận, xoá mã — cùng 1 transaction.
  consumeLink(args: {
    userId: bigint;
    zaloUserId: string;
    zaloName?: string | null;
    name: string;
    username: string;
  }) {
    const { userId, zaloUserId, zaloName, name, username } = args;
    return prisma.$transaction([
      // 1 Zalo chỉ gắn 1 tài khoản: nếu uid này đang gắn user khác -> gỡ user kia trước (unique zalo_user_id).
      prisma.zaloUserBinding.deleteMany({ where: { zaloUserId, NOT: { userId } } }),
      prisma.zaloUserBinding.upsert({
        where: { userId },
        create: { userId, zaloUserId, zaloName: zaloName || null, status: 'ACTIVE' },
        update: { zaloUserId, zaloName: zaloName || null, status: 'ACTIVE', linkedAt: new Date() },
      }),
      // Kênh nhận ZALO = đích báo phản hồi khách. apiKeyEnv chỉ là fallback (token thật lấy từ DB).
      prisma.receiveChannel.upsert({
        where: { type_accountId: { type: 'ZALO', accountId: zaloUserId } },
        create: {
          name: `Zalo — ${name}`,
          type: 'ZALO',
          accountId: zaloUserId,
          apiKeyEnv: 'ZALO_OA_TOKEN_MAIN',
          isActive: true,
          note: `Kích hoạt bởi ${username}`,
        },
        update: { name: `Zalo — ${name}`, isActive: true, note: `Kích hoạt bởi ${username}` },
      }),
      prisma.zaloLinkRequest.delete({ where: { userId } }),
    ]);
  }

  findBindingStatus(zaloUserId: string) {
    return prisma.zaloUserBinding.findUnique({ where: { zaloUserId }, select: { status: true } });
  }
}
