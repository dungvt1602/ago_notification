import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { webReq } from '@common/http/web-request';
import { parseId } from '@common/http/parse-id';
import { AuditService } from '@common/audit/audit.service';
import { actorFromRequest } from '@common/audit/audit.helpers';
import {
  createRfqSchema,
  patchRfqSchema,
  rfqItemsSchema,
  type RfqItemInput,
} from '@core/validation/supplierRfq.schema';
import { buildCompare } from './rfq-compare';
import { httpError, MSG } from './rfq-errors';
import { invitationExpiry } from './rfq-token';
import { SupplierRfqRepository, type NewRfqItem, type RfqDetailRow } from './supplier-rfq.repository';

const STATUSES = ['DRAFT', 'SENT', 'CLOSED'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const TEST_SUPPLIER_NAME = 'Nhắn thử';

// "" -> null để cột tuỳ chọn không lưu chuỗi rỗng.
const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

const toNewItems = (items: RfqItemInput[]): NewRfqItem[] =>
  items.map((i) => ({
    product: i.product,
    spec: blank(i.spec),
    unit: blank(i.unit),
    quantity: i.quantity,
    note: blank(i.note),
  }));

// Năm theo giờ Việt Nam để mã RFQ không nhảy năm lệch 7 tiếng so với lịch của người dùng.
const vnYear = (d: Date) => new Date(d.getTime() + 7 * 60 * 60 * 1000).getUTCFullYear();

/*
 * Nhận diện ảnh theo "magic bytes" thay vì tin header content-type: ảnh này được phục vụ CÔNG KHAI nên chỉ nhận
 * định dạng raster an toàn (không SVG — SVG chứa được script).
 */
export function detectImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Hình RfqDetail theo hợp đồng FE.
export function toRfqDetail(r: RfqDetailRow) {
  return {
    id: r.id.toString(),
    code: r.code,
    title: r.title,
    note: r.note,
    currency: r.currency,
    deadline: r.deadline,
    status: r.status,
    hasImage: r.image !== null,
    createdAt: r.createdAt,
    items: r.items.map((i) => ({
      id: i.id.toString(),
      no: i.no,
      product: i.product,
      spec: i.spec,
      unit: i.unit,
      quantity: i.quantity === null ? null : i.quantity.toString(),
      note: i.note,
    })),
    invitations: r.invitations.map((v) => ({
      id: v.id.toString(),
      supplierId: v.supplierId === null ? null : v.supplierId.toString(),
      supplierName: v.supplier?.name ?? TEST_SUPPLIER_NAME,
      status: v.status,
      isTest: v.isTest,
      sentAt: v.sentAt,
      viewedAt: v.viewedAt,
      submittedAt: v.submittedAt,
      error: v.error,
    })),
  };
}

@Injectable()
export class SupplierRfqService {
  constructor(
    private readonly repo: SupplierRfqRepository,
    private readonly audit: AuditService,
  ) {}

  async list(q: { search?: string | null; status?: string | null }) {
    const where: Prisma.SupplierRfqWhereInput = {};
    const kw = q.search?.trim();
    if (kw) {
      where.OR = [
        { title: { contains: kw, mode: 'insensitive' } },
        { code: { contains: kw, mode: 'insensitive' } },
      ];
    }
    const st = q.status?.trim().toUpperCase();
    if (st && STATUSES.includes(st)) where.status = st;
    const rows = await this.repo.findMany(where);
    const submitted = await this.repo.countSubmittedByRfq(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id.toString(),
      code: r.code,
      title: r.title,
      status: r.status,
      currency: r.currency,
      deadline: r.deadline,
      createdAt: r.createdAt,
      itemCount: r._count.items,
      invitationCount: r._count.invitations,
      submittedCount: submitted.get(r.id.toString()) ?? 0,
    }));
  }

  async create(req: Request, body: unknown) {
    const input = createRfqSchema.parse(body);
    const actor = actorFromRequest(webReq(req));
    const row = await this.repo.createWithCode(
      vnYear(new Date()),
      {
        title: input.title,
        note: blank(input.note),
        currency: input.currency ? input.currency.toUpperCase() : 'VND',
        deadline: input.deadline ?? null,
        createdBy: actor.id ? BigInt(actor.id) : null,
      },
      toNewItems(input.items ?? []),
    );
    await this.audit.audit(webReq(req), { action: 'RFQ_TAO', target: `${row.code} · ${row.title}` });
    return toRfqDetail(row);
  }

  async detail(idRaw: string) {
    const row = await this.repo.findDetail(parseId(idRaw, 'Id yêu cầu báo giá'));
    if (!row) throw httpError(404, MSG.rfqNotFound);
    return toRfqDetail(row);
  }

  async update(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const input = patchRfqSchema.parse(body);
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status === 'CLOSED') throw new Error('Yêu cầu báo giá đã đóng, không thể sửa.');
    const data: Prisma.SupplierRfqUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.note !== undefined) data.note = blank(input.note);
    if (input.currency !== undefined) data.currency = input.currency.toUpperCase();
    if (input.deadline !== undefined) data.deadline = input.deadline;
    await this.repo.update(id, data);
    if (input.deadline !== undefined) {
      await this.repo.setRealInvitationsExpiry(id, invitationExpiry(input.deadline, new Date()));
    }
    await this.audit.audit(webReq(req), { action: 'RFQ_SUA', target: `${before.code} · ${before.title}` });
    return this.detail(idRaw);
  }

  async remove(req: Request, idRaw: string) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status !== 'DRAFT') throw new Error('Chỉ xoá được yêu cầu báo giá ở trạng thái Nháp.');
    await this.repo.remove(id);
    await this.audit.audit(webReq(req), { action: 'RFQ_XOA', target: `${before.code} · ${before.title}` });
    return { ok: true };
  }

  async replaceItems(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const input = rfqItemsSchema.parse(body);
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status !== 'DRAFT')
      throw new Error('Chỉ sửa mặt hàng khi yêu cầu báo giá còn ở trạng thái Nháp.');
    await this.repo.replaceItems(id, toNewItems(input.items));
    await this.audit.audit(webReq(req), {
      action: 'RFQ_SUA',
      target: `${before.code} · ${before.title}`,
      note: `${input.items.length} mặt hàng`,
    });
    return this.detail(idRaw);
  }

  async close(req: Request, idRaw: string) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status !== 'CLOSED') {
      await this.repo.update(id, { status: 'CLOSED' });
      await this.audit.audit(webReq(req), { action: 'RFQ_DONG', target: `${before.code} · ${before.title}` });
    }
    return this.detail(idRaw);
  }

  // ---------- Ảnh ----------

  async setImage(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status === 'CLOSED') throw new Error('Yêu cầu báo giá đã đóng, không thể sửa.');
    const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (buf.byteLength === 0) throw new Error('Ảnh rỗng.');
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn (tối đa 5MB).');
    const mime = detectImageMime(buf);
    if (!mime) throw new Error('File không phải ảnh PNG, JPG, GIF hoặc WebP.');
    await this.repo.upsertImage(id, mime, buf);
    await this.audit.audit(webReq(req), {
      action: 'RFQ_DOI_ANH',
      target: `${before.code} · ${before.title}`,
      note: `${mime}, ${Math.round(buf.byteLength / 1024)} KB`,
    });
    return { ok: true, ...(await this.detail(idRaw)) };
  }

  async clearImage(req: Request, idRaw: string) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const before = await this.repo.findById(id);
    if (!before) throw httpError(404, MSG.rfqNotFound);
    if (before.status === 'CLOSED') throw new Error('Yêu cầu báo giá đã đóng, không thể sửa.');
    await this.repo.clearImage(id);
    await this.audit.audit(webReq(req), {
      action: 'RFQ_XOA_ANH',
      target: `${before.code} · ${before.title}`,
    });
    return { ok: true, ...(await this.detail(idRaw)) };
  }

  // GET công khai: id sai/chưa có ảnh -> null (controller trả 404 text "Chưa có ảnh").
  async image(idRaw: string): Promise<{ mime: string; data: Uint8Array; updatedAt: Date } | null> {
    if (!/^\d{1,18}$/.test(idRaw)) return null;
    const img = await this.repo.findImage(BigInt(idRaw));
    return img ? { mime: img.mime, data: img.data, updatedAt: img.updatedAt } : null;
  }

  // ---------- So sánh ----------

  async compare(idRaw: string) {
    const row = await this.repo.findForCompare(parseId(idRaw, 'Id yêu cầu báo giá'));
    if (!row) throw httpError(404, MSG.rfqNotFound);
    return buildCompare(
      row,
      row.items,
      row.invitations.map((v) => ({
        id: v.id,
        supplierId: v.supplierId,
        supplierName: v.supplier?.name ?? TEST_SUPPLIER_NAME,
        status: v.status,
        isTest: v.isTest,
        quotes: v.quotes,
      })),
    );
  }

  // ---------- Người nhận tin thử ----------

  async testRecipients() {
    const rows = await this.repo.findActiveZaloStaff();
    return rows
      .map((b) => ({
        userId: b.user.id.toString(),
        name: b.user.fullName?.trim() || b.user.username,
        zaloUserId: b.zaloUserId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }
}
