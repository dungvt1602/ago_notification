/*
 * Tầng truy cập DB của đồng bộ Meta (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class MetaSyncRepository {
  upsertWabaId(wabaId: string) {
    return prisma.appSetting.upsert({
      where: { key: 'waba_id' },
      create: { key: 'waba_id', value: wabaId },
      update: { value: wabaId },
    });
  }

  findWabaIdSetting() {
    return prisma.appSetting.findUnique({ where: { key: 'waba_id' } });
  }

  findActiveWhatsappChannel() {
    return prisma.channel.findFirst({
      where: { type: 'WHATSAPP', isActive: true },
      select: { accountId: true },
      orderBy: { id: 'asc' },
    });
  }

  findTemplatesWithMetaName() {
    return prisma.template.findMany({
      where: { waTemplateName: { not: null } },
      select: { id: true, name: true, waTemplateName: true, waFlow: true, waImage: true },
    });
  }

  updateTemplateFlags(id: bigint, data: Record<string, boolean>) {
    return prisma.template.update({ where: { id }, data });
  }
}
