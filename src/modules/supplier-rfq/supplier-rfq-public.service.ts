import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '@common/audit/audit.service';
import { submitQuoteSchema } from '@core/validation/supplierRfq.schema';
import { httpError, MSG } from './rfq-errors';
import { hashToken, looksLikeToken } from './rfq-token';
import { PublicRateLimiter } from './rate-limiter';
import { SupplierRfqRepository, type PublicInvitationRow } from './supplier-rfq.repository';
import { TEST_SUPPLIER_NAME } from './supplier-rfq.service';

/*
 * API CÔNG KHAI theo token (NCC mở link từ Zalo, không đăng nhập). Quy tắc an toàn:
 *  - chỉ trả dữ liệu của ĐÚNG lời mời này: không có NCC khác, không lộ token_hash / id lời mời;
 *  - mọi lượt (kể cả token sai) đều qua giới hạn tần suất theo (tiền tố hash token + IP);
 *  - token sai/hết hạn đều trả cùng một 404 để không dò được token nào tồn tại.
 */
@Injectable()
export class SupplierRfqPublicService {
  constructor(
    private readonly repo: SupplierRfqRepository,
    private readonly limiter: PublicRateLimiter,
    private readonly audit: AuditService,
  ) {}

  // Rate limit -> tra token -> kiểm hạn link. Ném 429/404 đúng hợp đồng.
  private async resolve(req: Request, token: string): Promise<PublicInvitationRow> {
    const hash = hashToken(token);
    if (!this.limiter.allow(hash.slice(0, 16), req.ip ?? 'unknown')) {
      throw httpError(429, MSG.tooFast);
    }
    if (!looksLikeToken(token)) throw httpError(404, MSG.linkInvalid);
    const inv = await this.repo.findInvitationByHash(hash);
    if (!inv || inv.expiresAt.getTime() < Date.now()) throw httpError(404, MSG.linkInvalid);
    return inv;
  }

  private static canSubmit(inv: PublicInvitationRow, now: Date) {
    const closed = inv.rfq.status === 'CLOSED';
    const pastDeadline = inv.rfq.deadline !== null && now.getTime() > inv.rfq.deadline.getTime();
    return { closed, pastDeadline, canSubmit: !closed && !pastDeadline };
  }

  async get(req: Request, token: string) {
    const inv = await this.resolve(req, token);
    const now = new Date();
    if (inv.viewedAt === null || inv.status === 'SENT') await this.repo.markViewed(inv.id, now);
    const { rfq } = inv;
    const { closed, pastDeadline, canSubmit } = SupplierRfqPublicService.canSubmit(inv, now);
    const q = inv.quotes[0];
    return {
      rfq: {
        code: rfq.code,
        title: rfq.title,
        note: rfq.note,
        currency: rfq.currency,
        deadline: rfq.deadline,
        hasImage: rfq.image !== null,
        imageUrl: rfq.image ? `/api/supplier-rfqs/${rfq.id}/image` : null,
      },
      supplierName: inv.supplier?.name ?? TEST_SUPPLIER_NAME,
      isTest: inv.isTest,
      expired: closed || pastDeadline,
      canSubmit,
      items: rfq.items.map((i) => ({
        id: i.id.toString(),
        no: i.no,
        product: i.product,
        spec: i.spec,
        unit: i.unit,
        quantity: i.quantity === null ? null : i.quantity.toString(),
        note: i.note,
      })),
      quote: q
        ? {
            version: q.version,
            currency: q.currency,
            validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null,
            note: q.note,
            items: q.items.map((it) => ({
              rfqItemId: it.rfqItemId.toString(),
              unitPrice: it.unitPrice.toString(),
              moq: it.moq === null ? null : it.moq.toString(),
              leadTimeDays: it.leadTimeDays,
              note: it.note,
            })),
          }
        : null,
    };
  }

  async submit(req: Request, token: string, body: unknown) {
    const inv = await this.resolve(req, token);
    const now = new Date();
    const { closed, pastDeadline } = SupplierRfqPublicService.canSubmit(inv, now);
    if (closed) throw new Error(MSG.rfqClosed);
    if (pastDeadline) throw new Error(MSG.pastDeadline);

    const input = submitQuoteSchema.parse(body);
    const { rfq } = inv;
    const itemIds = new Set(rfq.items.map((i) => i.id.toString()));
    if (input.items.some((i) => !itemIds.has(i.rfqItemId))) {
      throw new Error('Mặt hàng không thuộc yêu cầu báo giá này.');
    }
    const lines = input.items
      .filter((i) => i.unitPrice !== null)
      .map((i) => ({
        rfqItemId: BigInt(i.rfqItemId),
        unitPrice: i.unitPrice as string,
        moq: i.moq,
        leadTimeDays: i.leadTimeDays,
        note: i.note?.trim() ? i.note.trim() : null,
      }));
    // Một RFQ một tiền tệ (so sánh giá chỉ có nghĩa khi cùng đơn vị): NCC không được tự đổi.
    if (input.currency !== undefined && input.currency.toUpperCase() !== rfq.currency.toUpperCase()) {
      throw new Error(`Tiền tệ phải là ${rfq.currency}.`);
    }
    const currency = rfq.currency.toUpperCase();
    const note = input.note?.trim() ? input.note.trim() : null;
    const validUntil = input.validUntil ? new Date(input.validUntil + 'T00:00:00.000Z') : null;
    const supplierName = inv.supplier?.name ?? TEST_SUPPLIER_NAME;

    const r = await this.repo.submitQuote({
      invitationId: inv.id,
      currency,
      validUntil,
      note,
      lines,
      now,
      // Lời mời thử không phát sự kiện cho ERP; lời mời thật ghi outbox cùng transaction với báo giá.
      outbox: ({ version }) =>
        inv.isTest
          ? null
          : {
              eventType: 'supplier_quote.submitted',
              eventVersion: 'v1',
              aggregateType: 'SupplierRfq',
              aggregateId: rfq.id.toString(),
              aggregateCode: rfq.code,
              status: 'PENDING',
              payload: {
                rfqId: rfq.id.toString(),
                rfqCode: rfq.code,
                invitationId: inv.id.toString(),
                supplierId: inv.supplierId === null ? null : inv.supplierId.toString(),
                supplierName,
                version,
                currency,
                validUntil: input.validUntil,
                note,
                submittedAt: now.toISOString(),
                items: lines.map((l) => ({
                  rfqItemId: l.rfqItemId.toString(),
                  unitPrice: l.unitPrice,
                  moq: l.moq,
                  leadTimeDays: l.leadTimeDays,
                  note: l.note,
                })),
              },
            },
    });
    await this.audit.audit(null, {
      action: 'NCC_NOP_GIA',
      target: `${rfq.code} · ${supplierName}`,
      note: `phiên bản ${r.version}${inv.isTest ? ' (thử)' : ''}`,
      actor: { id: null, name: supplierName },
    });
    return { ok: true, version: r.version };
  }
}
