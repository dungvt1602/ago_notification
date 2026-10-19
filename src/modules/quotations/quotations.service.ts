import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeTotal } from '@core/lib/placeholders';
import {
  createQuotationSchema,
  updateQuotationSchema,
  setItemsSchema,
  type CreateQuotationInput,
  type UpdateQuotationInput,
  type ItemInput,
} from '@core/validation/quotation.schema';
import { createTemplateSchema } from '@core/validation/template.schema';
import { labelOf, diffSummary } from '@common/audit/audit.helpers';
import { AuditService } from '@common/audit/audit.service';
import type { ReqLike } from '@core/http/reqLike';
import { TemplatesService } from '../templates/templates.service';
import { QuotationsRepository } from './quotations.repository';

// "2026-08-20" -> Date (nửa đêm UTC, cột kiểu @db.Date). Chuỗi rỗng -> null.
function toDate(v: string | null | undefined) {
  return v ? new Date(v) : null;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly repo: QuotationsRepository,
    private readonly auditService: AuditService,
    // forwardRef: templates <-> quotations gọi chéo nhau (tạo template trong báo giá / tạo báo giá kèm template).
    @Inject(forwardRef(() => TemplatesService)) private readonly templatesService: TemplatesService,
  ) {}

  listQuotations() {
    return this.repo.findAllWithTemplateCount();
  }

  // Mã tự sinh theo năm: BG-2026-0001, BG-2026-0002... (theo mã lớn nhất đang có).
  private async nextQuotationCode() {
    const prefix = `BG-${new Date().getFullYear()}-`;
    const last = await this.repo.findLastCodeByPrefix(prefix);
    const n = last ? Number(last.code.slice(prefix.length)) || 0 : 0;
    return prefix + String(n + 1).padStart(4, '0');
  }

  async createQuotation(input: CreateQuotationInput) {
    const code = input.code?.trim() || (await this.nextQuotationCode());
    return this.repo.create({
      code,
      title: input.title ?? null,
      totalAmount: (input.totalAmount ?? 0).toString(),
      currency: input.currency ?? 'VND',
      status: input.status ?? 'DRAFT',
      market: input.market ?? null,
      issuedDate: toDate(input.issuedDate),
      validUntil: toDate(input.validUntil),
    });
  }

  // Sửa thông tin báo giá. Chỉ đụng vào field được gửi lên.
  updateQuotation(id: string, input: UpdateQuotationInput) {
    const data: Record<string, unknown> = {};
    if (input.code !== undefined) data.code = input.code.trim();
    if (input.title !== undefined) data.title = input.title || null;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.status !== undefined) data.status = input.status;
    if (input.market !== undefined) data.market = input.market || null;
    if (input.issuedDate !== undefined) data.issuedDate = toDate(input.issuedDate);
    if (input.validUntil !== undefined) data.validUntil = toDate(input.validUntil);
    return this.repo.update(BigInt(id), data as Prisma.QuotationUncheckedUpdateInput);
  }

  getQuotationWithItems(id: string) {
    return this.repo.findWithItems(BigInt(id));
  }

  // Chi tiết đầy đủ 1 báo giá: sản phẩm + template thuộc về nó.
  getQuotationDetail(id: string) {
    return this.repo.findDetail(BigInt(id));
  }

  // Xóa báo giá: dọn lệnh gửi/jobs, gỡ template về kho, xóa items + gán user, rồi xóa báo giá.
  async deleteQuotation(id: string) {
    const qid = BigInt(id);

    // CHẶN xoá khi còn tin CHƯA gửi — cùng lý do với deleteTemplate: xoá báo giá kéo theo cả
    // send_batches lẫn send_jobs, hàng đợi đang chạy dở sẽ bốc hơi im lặng.
    const pending = await this.repo.countPendingJobs(qid);
    if (pending > 0) {
      throw new Error(
        `Báo giá này còn ${pending} tin chưa gửi trong hàng đợi. Vào màn Gửi báo giá huỷ lệnh đang chạy trước, rồi mới xoá báo giá.`,
      );
    }

    const batches = await this.repo.findBatchIds(qid);
    const batchIds = batches.map((b) => b.id);
    await this.repo.deleteCascade(qid, batchIds);
    return { ok: true };
  }

  listItems(quotationId: string) {
    return this.repo.findItems(BigInt(quotationId));
  }

  // Thay TOÀN BỘ mặt hàng + tự tính lại tổng tiền.
  async setItems(quotationId: string, rawItems: ItemInput[]) {
    const qid = BigInt(quotationId);
    const items = rawItems
      .filter((it) => (it.product ?? '').trim())
      .map((it, i) => ({
        quotationId: qid,
        no: Number(it.no ?? i + 1),
        product: String(it.product ?? '').trim(),
        packing: it.packing ? String(it.packing) : null,
        unit: it.unit ? String(it.unit) : null,
        quantity: it.quantity != null ? String(it.quantity) : '1',
        price: it.price != null ? String(it.price) : '0',
        note: it.note ? String(it.note) : null,
      }));

    const total = computeTotal(items.map((it) => ({ quantity: it.quantity, price: it.price })));

    await this.repo.replaceItems(qid, items, total);

    const saved = await this.repo.findItems(qid);
    return { items: saved, totalAmount: total };
  }

  // ---- Điều phối HTTP + audit ----

  list() {
    return this.listQuotations();
  }

  async create(req: ReqLike, body: unknown) {
    const input = createQuotationSchema.parse(body);
    const q = await this.createQuotation(input);
    await this.auditService.audit(req, {
      action: 'BAO_GIA_TAO',
      target: labelOf('quotation', q as unknown as Record<string, unknown>),
      note: diffSummary(null, input as Record<string, unknown>),
    });
    return q;
  }

  // Trả null nếu không có — controller quyết định 404.
  detail(id: string) {
    return this.getQuotationDetail(id);
  }

  async update(req: ReqLike, id: string, body: unknown) {
    const input = updateQuotationSchema.parse(body);
    const before = await this.auditService.snapshot('quotation', id);
    const r = await this.updateQuotation(id, input);
    await this.auditService.audit(req, {
      action: 'BAO_GIA_SUA',
      target: labelOf('quotation', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(req: ReqLike, id: string) {
    const before = await this.auditService.snapshot('quotation', id);
    const r = await this.deleteQuotation(id);
    await this.auditService.audit(req, { action: 'BAO_GIA_XOA', target: labelOf('quotation', before, id) });
    return r;
  }

  items(id: string) {
    return this.listItems(id);
  }

  async putItems(req: ReqLike, id: string, body: unknown) {
    const items = setItemsSchema.parse(body).items;
    const before = await this.listItems(id).catch(() => []);
    const r = await this.setItems(id, items);
    const q = await this.auditService.snapshot('quotation', id);
    const names = items
      .slice(0, 5)
      .map((it) => it.product)
      .filter(Boolean)
      .join(', ');
    await this.auditService.audit(req, {
      action: 'BAO_GIA_SUA_MAT_HANG',
      target: labelOf('quotation', q, id),
      note: `${before.length} → ${items.length} mặt hàng${names ? ': ' + names + (items.length > 5 ? '…' : '') : ''}`,
    });
    return r;
  }

  templates(id: string) {
    return this.templatesService.listTemplatesByQuotation(id);
  }

  async createTemplate(req: ReqLike, id: string, body: unknown) {
    const input = createTemplateSchema.parse(body);
    const t = await this.templatesService.createTemplate(id, input);
    const q = await this.auditService.snapshot('quotation', id);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_TAO',
      target: labelOf('template', t as unknown as Record<string, unknown>),
      note: `thuộc báo giá ${labelOf('quotation', q, id)}${input.waTemplateName ? '; template Meta: ' + input.waTemplateName : ''}`,
    });
    return t;
  }
}
