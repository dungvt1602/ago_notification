import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { webReq } from '@common/http/web-request';
import {
  createCustomerSchema,
  patchCustomerSchema,
  type CreateCustomerInput,
  type PatchCustomerInput,
} from '@core/validation/customer.schema';
import { detectPhoneType } from '@core/lib/phoneType';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';
import { CustomersRepository, type CustomerWithLinks } from './customers.repository';

export type ListCustomersOptions = {
  excludeTemplate?: string | null; // trả ứng viên CHƯA thuộc template này
  market?: string | null; // lọc theo quốc gia (thị trường)
  search?: string | null; // tìm theo tên / công ty / SĐT / email / quốc gia
  phoneType?: string | null; // lọc theo loại số (MOBILE | FIXED_LINE | AMBIGUOUS | UNKNOWN)
  hasWhatsapp?: boolean | null; // true = chỉ lấy khách CÓ số WhatsApp (whatsappPhone not null)
  sort?: string | null; // cột sắp xếp (chỉ nhận các cột trong SORTABLE)
  dir?: string | null; // asc | desc
};

export type ListCustomersPagedOptions = ListCustomersOptions & { page?: number; limit?: number };

// Sắp xếp phía server (màn Khách hàng phân trang server). Cột có thể trống -> đẩy ô trống xuống cuối.
// Thêm id làm khoá phụ để thứ tự ổn định giữa các trang (không lặp/sót khách khi chuyển trang).
const SORTABLE = [
  'name',
  'company',
  'whatsappPhone',
  'phone',
  'email',
  'market',
  'status',
  'phoneType',
] as const;
const NULLABLE_SORT = new Set(['company', 'whatsappPhone', 'phone', 'email', 'market', 'phoneType']);
function buildCustomerOrder(opts: ListCustomersOptions): Prisma.CustomerOrderByWithRelationInput[] {
  const key = (SORTABLE as readonly string[]).includes(opts.sort || '') ? (opts.sort as string) : 'name';
  const dir: Prisma.SortOrder = opts.dir === 'desc' ? 'desc' : 'asc';
  const primary = NULLABLE_SORT.has(key) ? { [key]: { sort: dir, nulls: 'last' } } : { [key]: dir };
  return [primary as Prisma.CustomerOrderByWithRelationInput, { id: 'asc' }];
}

// Dựng điều kiện WHERE dùng chung cho list thường & list phân trang.
function buildCustomerWhere(opts: ListCustomersOptions): Prisma.CustomerWhereInput {
  const { excludeTemplate, market, search, phoneType, hasWhatsapp } = opts;
  const and: Prisma.CustomerWhereInput[] = [];

  if (excludeTemplate) {
    // N-N: ứng viên = khách CHƯA có link tới template này.
    and.push({ NOT: { templateLinks: { some: { templateId: BigInt(excludeTemplate) } } } });
  }
  if (market && market.trim()) {
    and.push({ market: { equals: market.trim(), mode: 'insensitive' } });
  }
  if (phoneType && phoneType.trim()) {
    and.push({ phoneType: { equals: phoneType.trim().toUpperCase() } });
  }
  // Chỉ khách CÓ số WhatsApp. Lưu ý: cột để trống VÀ chuỗi rỗng đều tính là "không có" — dữ liệu
  // nhập từ Excel hay lọt ô rỗng, lọc thiếu vế này thì khách không có số vẫn lọt vào danh sách gửi.
  if (hasWhatsapp) {
    and.push({ whatsappPhone: { not: null } });
    and.push({ NOT: { whatsappPhone: '' } });
  }
  const kw = search?.trim();
  if (kw) {
    and.push({
      OR: [
        { name: { contains: kw, mode: 'insensitive' } },
        { company: { contains: kw, mode: 'insensitive' } },
        { phone: { contains: kw, mode: 'insensitive' } },
        { whatsappPhone: { contains: kw, mode: 'insensitive' } },
        { email: { contains: kw, mode: 'insensitive' } },
        { market: { contains: kw, mode: 'insensitive' } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

// Đổi templateLinks -> mảng `templates` cho gọn phía FE.
function shapeCustomer(c: CustomerWithLinks) {
  const { templateLinks, ...rest } = c;
  return { ...rest, templates: templateLinks.map((l) => l.template) };
}

// Dọn 1 dòng nhập trước khi kiểm tra: ô PHỤ sai định dạng chỉ bỏ ô đó, không loại cả khách
// (vd email ghi 2 địa chỉ "a@x.kr b.com" -> lấy địa chỉ hợp lệ đầu tiên, không có thì để trống).
// Quốc gia viết HOA cho khớp dữ liệu sẵn có ("Japan" -> "JAPAN").
const IMPORT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanImportRow(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.email === 'string' && r.email && !IMPORT_EMAIL_RE.test(r.email)) {
    r.email = r.email.split(/[\s;,]+/).find((p) => IMPORT_EMAIL_RE.test(p)) || '';
  }
  if (typeof r.phone === 'string' && r.phone && !/^\d{6,15}$/.test(r.phone)) r.phone = '';
  if (typeof r.market === 'string') r.market = r.market.trim().toUpperCase();
  return r;
}

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  // ---- Logic gốc (tên/chữ ký giữ nguyên, module khác gọi trực tiếp) ----

  async listCustomers(opts: ListCustomersOptions = {}) {
    const rows = await this.repo.findManyWithLinks({
      where: buildCustomerWhere(opts),
      orderBy: buildCustomerOrder(opts),
    });
    return rows.map(shapeCustomer);
  }

  // Danh sách khách có PHÂN TRANG (cho trang quản lý khách của template).
  async listCustomersPaged(opts: ListCustomersPagedOptions = {}) {
    const where = buildCustomerWhere(opts);
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 20)));
    const [items, total] = await Promise.all([
      this.repo.findManyWithLinks({
        where,
        orderBy: buildCustomerOrder(opts),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.repo.count(where),
    ]);
    return { items: items.map(shapeCustomer), total, page, limit };
  }

  // CHỌN TẤT CẢ: chỉ trả id của mọi khách khớp bộ lọc (không phân trang) — nhẹ, để FE tick hết dù có 45 trang.
  // Kèm templateId -> trả thêm id nào đang thuộc template đó (để đếm "thêm" / "gỡ" đúng khi chọn xuyên trang).
  async listCustomerIds(opts: ListCustomersOptions & { templateId?: string | null }) {
    const where = buildCustomerWhere(opts);
    const rows = await this.repo.findIds(where);
    const ids = rows.map((r) => String(r.id));
    let inTemplateIds: string[] = [];
    if (opts.templateId && ids.length) {
      const links = await this.repo.findTemplateLinks(
        BigInt(opts.templateId),
        rows.map((r) => r.id),
      );
      inTemplateIds = links.map((l) => String(l.customerId));
    }
    return { ids, total: ids.length, inTemplateIds };
  }

  // Xoá hàng loạt — 1 câu lệnh thay vì N request. Trả số dòng đã xoá + vài tên đầu.
  // Huỷ tin CHƯA gửi của khách sắp xoá (send_jobs.customer_id là SetNull nên job vẫn được worker gửi
  // đi); huỷ + xoá CHUNG một transaction, không đụng job đang SENDING.
  async deleteCustomersBulk(ids: (string | number)[]) {
    const bigIds = ids.map((i) => BigInt(i));
    if (!bigIds.length) return { deleted: 0, sample: [] as string[], cancelledJobs: 0 };
    const sample = await this.repo.findNamesSample(bigIds);
    const [cancelled, r] = await this.repo.cancelJobsAndDeleteMany(bigIds); // cascade xoá link template
    return { deleted: r.count, sample: sample.map((s) => s.name), cancelledJobs: cancelled.count };
  }

  // Danh sách quốc gia (market) khác nhau — dùng cho dropdown lọc.
  async listCustomerMarkets(): Promise<string[]> {
    const rows = await this.repo.findDistinctMarkets();
    return rows.map((r) => r.market ?? '').filter((m) => m.trim() !== '');
  }

  createCustomer(input: CreateCustomerInput) {
    const templateId = input.templateId;
    const waPhone = input.whatsappPhone ?? input.phone ?? null;
    return this.repo.create({
      name: input.name,
      company: input.company ?? null,
      phone: input.phone ?? null,
      whatsappPhone: waPhone,
      email: input.email ?? null,
      market: input.market ?? null,
      status: input.status ?? 'ACTIVE',
      receiveQuotation: input.receiveQuotation ?? true,
      note: input.note ?? null,
      phoneType: detectPhoneType(waPhone, input.market),
      // Nếu có templateId -> tạo luôn link N-N.
      ...(templateId ? { templateLinks: { create: { templateId: BigInt(templateId) } } } : {}),
    });
  }

  // Nhập hàng loạt khách hàng từ file (Excel/CSV đã parse ở client thành mảng object).
  // Validate từng dòng, bỏ trùng WhatsApp trong file và trùng DB, tạo theo lô.
  async importCustomers(rows: unknown[]): Promise<{
    created: number;
    skippedDup: number;
    invalid: { row: number; reason: string }[];
  }> {
    const invalid: { row: number; reason: string }[] = [];
    const valid: CreateCustomerInput[] = [];
    const seen = new Set<string>();

    rows.forEach((raw, i) => {
      const parsed = createCustomerSchema.safeParse(cleanImportRow(raw));
      if (!parsed.success) {
        invalid.push({ row: i + 2, reason: parsed.error.issues[0]?.message || 'Dữ liệu không hợp lệ' }); // +2: bỏ dòng tiêu đề
        return;
      }
      const wa = parsed.data.whatsappPhone;
      if (seen.has(wa)) {
        invalid.push({ row: i + 2, reason: `Trùng WhatsApp ${wa} trong file` });
        return;
      }
      seen.add(wa);
      valid.push(parsed.data);
    });

    // Chia lô: file lớn (vd 16k dòng) mà 1 câu lệnh thì vượt trần 65.535 tham số của Postgres.
    const CHUNK = 1000;
    const waList = [...seen];
    const existSet = new Set<string | null>();
    for (let i = 0; i < waList.length; i += CHUNK) {
      const existing = await this.repo.findExistingByWhatsapp(waList.slice(i, i + CHUNK));
      existing.forEach((e) => existSet.add(e.whatsappPhone));
    }
    // Bỏ khách đã tồn tại trong DB (theo whatsappPhone).
    const toCreate = valid.filter((v) => !existSet.has(v.whatsappPhone));
    const skippedDup = valid.length - toCreate.length;

    let created = 0;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const r = await this.repo.createMany(
        toCreate.slice(i, i + CHUNK).map((v) => ({
          name: v.name,
          company: v.company ?? null,
          phone: v.phone ?? null,
          whatsappPhone: v.whatsappPhone ?? v.phone ?? null,
          email: v.email ?? null,
          market: v.market ?? null,
          status: v.status ?? 'ACTIVE',
          receiveQuotation: v.receiveQuotation ?? true,
          note: v.note ?? null,
          phoneType: detectPhoneType(v.whatsappPhone ?? v.phone ?? null, v.market),
        })),
      );
      created += r.count;
    }
    return { created, skippedDup, invalid };
  }

  // PATCH: chỉ sửa thông tin khách (gán/gỡ template chuyển sang API link riêng).
  async updateCustomer(id: string, input: PatchCustomerInput) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.company !== undefined) data.company = input.company;
    if (input.whatsappPhone !== undefined) data.whatsappPhone = input.whatsappPhone;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.market !== undefined) data.market = input.market;
    if (input.status !== undefined) data.status = input.status;
    if (input.receiveQuotation !== undefined) data.receiveQuotation = input.receiveQuotation;
    if (input.note !== undefined) data.note = input.note;

    // Loại số phải tính LẠI khi SĐT/quốc gia đổi; chỉ đọc thêm bản ghi khi PATCH đụng tới 3 trường đó
    // (lấy field KHÔNG được gửi lên vì PATCH một phần).
    if (input.whatsappPhone !== undefined || input.phone !== undefined || input.market !== undefined) {
      const cur = await this.repo.findPhoneFields(BigInt(id));
      const waPhone = input.whatsappPhone !== undefined ? input.whatsappPhone : (cur?.whatsappPhone ?? null);
      const phone = input.phone !== undefined ? input.phone : (cur?.phone ?? null);
      const market = input.market !== undefined ? input.market : (cur?.market ?? null);
      data.phoneType = detectPhoneType(waPhone || phone, market);
    }

    return this.repo.update(BigInt(id), data);
  }

  async deleteCustomer(id: string) {
    const [cancelled] = await this.repo.cancelJobsAndDeleteOne(BigInt(id)); // cascade xoá link
    return { ok: true, cancelledJobs: cancelled.count };
  }

  // ---- Quản lý liên kết N-N template <-> customer ----
  async addCustomerToTemplate(templateId: string, customerId: string) {
    await this.repo.upsertTemplateLink({ templateId: BigInt(templateId), customerId: BigInt(customerId) });
    return { ok: true };
  }

  async removeCustomerFromTemplate(templateId: string, customerId: string) {
    await this.repo.deleteTemplateLink(BigInt(templateId), BigInt(customerId));
    return { ok: true };
  }

  // ---- Điều phối cho controller (parse + audit) ----

  async createWithAudit(body: unknown, req: Request) {
    const input = createCustomerSchema.parse(body);
    const c = await this.createCustomer(input);
    await audit(webReq(req), {
      action: 'KHACH_HANG_TAO',
      target: labelOf('customer', c as unknown as Record<string, unknown>),
      note: diffSummary(null, input as Record<string, unknown>),
    });
    return c;
  }

  async bulkDeleteWithAudit(raw: unknown, req: Request) {
    const body = (raw ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((s) => /^\d+$/.test(s)) : [];
    if (!ids.length) throw new Error('Chưa chọn khách nào.');
    const r = await this.deleteCustomersBulk(ids);
    await audit(webReq(req), {
      action: 'KHACH_HANG_XOA',
      target: `${r.deleted} khách hàng`,
      note: r.sample.length ? `vd: ${r.sample.join(', ')}${r.deleted > r.sample.length ? '…' : ''}` : null,
    });
    return r;
  }

  async importWithAudit(raw: unknown, req: Request) {
    const inner = (raw as { rows?: unknown } | null)?.rows;
    const rows = (Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : []) as unknown[];
    const r = (await this.importCustomers(rows)) as Record<string, unknown>;
    const summary = Object.entries(r)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    await audit(webReq(req), {
      action: 'KHACH_HANG_NHAP_FILE',
      target: `${rows.length} dòng`,
      note: summary || null,
    });
    return r;
  }

  async updateWithAudit(id: string, body: unknown, req: Request) {
    const input = patchCustomerSchema.parse(body);
    const before = await snapshot('customer', id);
    const r = await this.updateCustomer(id, input);
    await audit(webReq(req), {
      action: 'KHACH_HANG_SUA',
      target: labelOf('customer', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async removeWithAudit(id: string, req: Request) {
    const before = await snapshot('customer', id);
    const r = await this.deleteCustomer(id);
    await audit(webReq(req), {
      action: 'KHACH_HANG_XOA',
      target: labelOf('customer', before, id),
      note: before ? [before.phone, before.whatsappPhone, before.market].filter(Boolean).join(' · ') : null,
    });
    return r;
  }
}
