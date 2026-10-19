import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class ZaloTokenRepository {
  findSetting(key: string) {
    return prisma.appSetting.findUnique({ where: { key } });
  }

  upsertSetting(key: string, value: string) {
    return prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  deleteSetting(key: string) {
    return prisma.appSetting.deleteMany({ where: { key } });
  }

  findLatestOaId() {
    return prisma.zaloOaToken.findFirst({ select: { oaId: true }, orderBy: { updatedAt: 'desc' } });
  }

  upsertTokens(oaId: string, t: { accessToken: string; refreshToken: string }, expiresAt: Date) {
    return prisma.zaloOaToken.upsert({
      where: { oaId },
      create: { oaId, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt },
      update: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt },
    });
  }

  findTokenByOaId(oaId: string) {
    return prisma.zaloOaToken.findUnique({ where: { oaId } });
  }

  findLatestToken() {
    return prisma.zaloOaToken.findFirst({ orderBy: { updatedAt: 'desc' } });
  }

  // update rỗng: 2 luồng cùng bootstrap không đụng unique.
  upsertBootstrap(oaId: string, refreshToken: string) {
    return prisma.zaloOaToken.upsert({
      where: { oaId },
      create: { oaId, accessToken: '', refreshToken, expiresAt: new Date() },
      update: {},
    });
  }

  deleteAllTokens() {
    return prisma.zaloOaToken.deleteMany({});
  }
}
