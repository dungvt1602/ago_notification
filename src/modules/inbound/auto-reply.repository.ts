/*
 * Tầng truy cập DB duy nhất của luồng trả lời tự động. Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class AutoReplyRepository {
  findAutoReplyTemplate() {
    return prisma.template.findFirst({
      where: { autoReply: true, isActive: true, waTemplateName: { not: null } },
      include: { channel: true },
      orderBy: { id: 'asc' },
    });
  }

  linkCustomerToTemplate(templateId: bigint, customerId: bigint) {
    return prisma.templateCustomer.createMany({
      data: [{ templateId, customerId }],
      skipDuplicates: true,
    });
  }

  findRecentAutoReplied(fromPhone: string, since: Date, excludeId: bigint) {
    return prisma.inboundMessage.findFirst({
      where: { fromPhone, autoReplied: true, receivedAt: { gte: since }, id: { not: excludeId } },
      select: { id: true },
    });
  }

  findImageMeta(templateId: bigint) {
    return prisma.templateImage.findUnique({
      where: { templateId },
      select: { waMediaId: true, waMediaAt: true },
    });
  }

  saveMediaId(templateId: bigint, waMediaId: string) {
    return prisma.templateImage.update({
      where: { templateId },
      data: { waMediaId, waMediaAt: new Date() },
    });
  }

  markAutoReplied(id: bigint) {
    return prisma.inboundMessage.update({ where: { id }, data: { autoReplied: true } });
  }
}
