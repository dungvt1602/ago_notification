import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomersService } from '../customers/customers.service';
import { QuotationsService } from '../quotations/quotations.service';
import {
  createTemplateSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type UpdateTemplateInput,
} from '@core/validation/template.schema';
import { createCustomerSchema } from '@core/validation/customer.schema';
import {
  isStorageConfigured,
  templateImagePath,
  uploadImageToStorage,
  downloadImageFromStorage,
  deleteImageFromStorage,
  publicImageUrl,
} from '@core/lib/storage';
import { labelOf, diffSummary } from '@common/audit/audit.helpers';
import { AuditService } from '@common/audit/audit.service';
import type { ReqLike } from '@core/http/reqLike';
import { MetaSyncService } from './meta-sync.service';
import { TemplatesRepository } from './templates.repository';

export type TemplateListQuery = Record<string, string | undefined>;

// Kết quả GET ảnh: controller dựng response thật từ đây.
export type TemplateImageResult =
  | { kind: 'notFound' }
  | { kind: 'redirect'; url: string }
  | { kind: 'bytes'; mime: string; data: Uint8Array };

@Injectable()
export class TemplatesService {
  constructor(
    private readonly repo: TemplatesRepository,
    private readonly customersSvc: CustomersService,
    private readonly metaSync: MetaSyncService,
    private readonly auditService: AuditService,
    // forwardRef: templates <-> quotations gọi chéo nhau.
    @Inject(forwardRef(() => QuotationsService)) private readonly quotationsService: QuotationsService,
  ) {}

  // TỰ PHÁT HIỆN cờ từ Meta theo tên mẫu (lúc tạo/sửa template) — người dùng KHỎI tích
  // "có nút Flow" nữa. Tra không được (chưa WABA/lỗi mạng) -> {} giữ giá trị hiện có;
  // Meta không có mẫu tên này -> ném lỗi (bắt gõ sai tên ngay lúc lưu).
  private async detectMetaFlags(
    waTemplateName?: string | null,
  ): Promise<{ waFlow?: boolean; waImage?: boolean }> {
    if (!waTemplateName) return {};
    const def = await this.metaSync.getMetaTemplateDef(waTemplateName);
    if (!def) return {};
    if (!def.found) {
      throw new Error(
        `Không tìm thấy mẫu "${waTemplateName}" trên Meta — kiểm tra lại tên (phải đúng y tên mẫu đã tạo trên WhatsApp Manager).`,
      );
    }
    return { waFlow: def.hasFlow, waImage: def.hasImageHeader };
  }

  listTemplates() {
    return this.repo.findAll();
  }

  // Danh sách template có phân trang + tìm kiếm (tên / tên template Meta / mã báo giá).
  // Chịu được số lượng lớn (vd 1000 template) vì chỉ tải đúng 1 trang từ DB.
  // Trả { items, total, page, limit }.
  async listTemplatesPaged(params: {
    search?: string | null;
    page?: number;
    limit?: number;
    kind?: string | null; // "reply" = mẫu trả lời tự động | "send" = mẫu gửi báo giá | rỗng = tất cả
  }) {
    const kw = (params.search || '').trim();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 12));
    const where = {
      ...(kw
        ? {
            OR: [
              { name: { contains: kw, mode: 'insensitive' as const } },
              { waTemplateName: { contains: kw, mode: 'insensitive' as const } },
              { quotation: { code: { contains: kw, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(params.kind === 'reply' ? { autoReply: true } : params.kind === 'send' ? { autoReply: false } : {}),
    };
    const [items, total] = await this.repo.findPaged(where, (page - 1) * limit, limit);
    return { items, total, page, limit };
  }

  getTemplateDetail(id: string) {
    return this.repo.findDetail(BigInt(id));
  }

  // ---- Ảnh header của template (file trên Supabase Storage; DB chỉ giữ metadata) ----

  // Metadata ảnh (KHÔNG kéo bytes). storagePath có = ảnh nằm trên Storage.
  getTemplateImageMeta(id: bigint | number | string) {
    return this.repo.findImageMeta(BigInt(id));
  }

  // Lấy BYTES ảnh (để upload WhatsApp): ưu tiên Storage, fallback bytes DB (ảnh cũ legacy).
  async getTemplateImage(id: bigint | number | string): Promise<{ data: Uint8Array; mime: string } | null> {
    const row = await this.repo.findImageFull(BigInt(id));
    if (!row) return null;
    if (row.storagePath) {
      const ab = await downloadImageFromStorage(row.storagePath);
      if (ab) return { data: new Uint8Array(ab), mime: row.mime };
    }
    return row.data ? { data: new Uint8Array(row.data), mime: row.mime } : null;
  }

  // Chỉ kiểm tra CÓ ảnh hay không (không kéo bytes) — ảnh ~2MB, kéo mỗi vòng worker
  // từng làm cháy 11.6GB egress Supabase/ngày. Bytes chỉ tải đúng lúc cần upload.
  async hasTemplateImage(id: bigint | number | string): Promise<boolean> {
    const row = await this.repo.findImageMime(BigInt(id));
    return !!row;
  }

  // Lưu ảnh: Storage đã cấu hình -> upload path CỐ ĐỊNH (upsert = GHI ĐÈ ảnh cũ, không rác),
  // DB chỉ giữ metadata (data=null). Chưa có SUPABASE_SERVICE_ROLE_KEY -> fallback bytes DB.
  async setTemplateImage(id: string, data: ArrayBuffer, mime: string) {
    const templateId = BigInt(id);
    if (isStorageConfigured()) {
      const path = templateImagePath(id);
      await uploadImageToStorage(path, data, mime);
      await this.repo.upsertImageStorage(templateId, path, mime);
    } else {
      const bytes = new Uint8Array(data);
      await this.repo.upsertImageBytes(templateId, bytes, mime);
    }
    return { ok: true };
  }

  async clearTemplateImage(id: string) {
    const row = await this.repo.findImageStoragePath(BigInt(id));
    if (row?.storagePath) await deleteImageFromStorage(row.storagePath);
    await this.repo.deleteImages(BigInt(id));
    return { ok: true };
  }

  listTemplatesByQuotation(quotationId: string) {
    return this.repo.findByQuotation(BigInt(quotationId));
  }

  async createTemplate(quotationId: string, input: CreateTemplateInput) {
    const metaFlags = await this.detectMetaFlags(input.waTemplateName);
    return this.repo.create({
      quotationId: BigInt(quotationId),
      name: input.name,
      icon: input.icon ?? null,
      body: input.body ?? input.content ?? null,
      channelId: input.channelId ? BigInt(input.channelId) : null,
      waTemplateName: input.waTemplateName ?? null,
      waBodyParams: input.waBodyParams || null,
      ...(input.sendAsText != null ? { sendAsText: input.sendAsText } : {}),
      ...(input.waLanguage ? { waLanguage: input.waLanguage } : {}),
      ...(input.waCategory !== undefined ? { waCategory: input.waCategory ?? null } : {}),
      ...(input.waImage != null ? { waImage: input.waImage } : {}),
      ...(input.waFlow != null ? { waFlow: input.waFlow } : {}),
      ...(input.autoReply != null ? { autoReply: input.autoReply } : {}),
      ...metaFlags, // cờ tự phát hiện từ Meta GHI ĐÈ giá trị tay
    });
  }

  // Tạo template — TỰ gắn kèm 1 báo giá mặc định (rỗng) để gửi được ngay, không phải
  // vào chi tiết template gắn báo giá thủ công. Mỗi template có bảng giá riêng; sửa
  // mặt hàng/giá của báo giá này trong trang chi tiết template.
  async createStandaloneTemplate(input: CreateTemplateInput) {
    // Tra Meta TRƯỚC khi tạo báo giá kèm — gõ sai tên mẫu thì chặn ngay, không để báo giá mồ côi.
    const metaFlags = await this.detectMetaFlags(input.waTemplateName);
    const quotation = await this.quotationsService.createQuotation({
      title: input.name ? `Báo giá ${input.name}` : null,
    });
    return this.repo.create({
      quotationId: quotation.id,
      name: input.name,
      subject: input.subject ?? null, // tên sản phẩm
      icon: input.icon ?? null,
      body: input.body ?? input.content ?? null,
      channelId: input.channelId ? BigInt(input.channelId) : null,
      waTemplateName: input.waTemplateName ?? null,
      waBodyParams: input.waBodyParams || null,
      ...(input.sendAsText != null ? { sendAsText: input.sendAsText } : {}),
      ...(input.waLanguage ? { waLanguage: input.waLanguage } : {}),
      ...(input.waCategory !== undefined ? { waCategory: input.waCategory ?? null } : {}),
      ...(input.waImage != null ? { waImage: input.waImage } : {}),
      ...(input.waFlow != null ? { waFlow: input.waFlow } : {}),
      ...(input.autoReply != null ? { autoReply: input.autoReply } : {}),
      ...metaFlags, // cờ tự phát hiện từ Meta GHI ĐÈ giá trị tay
    });
  }

  // Template trong kho (chưa gắn báo giá nào) — ứng viên để gắn vào 1 báo giá.
  listPoolTemplates() {
    return this.repo.findPool();
  }

  // Gỡ hàng loạt khách khỏi template (1 câu lệnh). Khách vẫn còn trong kho / template khác.
  async unlinkCustomersFromTemplate(templateId: string, customerIds: (string | number)[]) {
    if (!customerIds.length) return { unlinked: 0 };
    const r = await this.repo.unlinkCustomers(
      BigInt(templateId),
      customerIds.map((cid) => BigInt(cid)),
    );
    return { unlinked: r.count };
  }

  // Gắn HÀNG LOẠT khách vào template (trùng thì bỏ qua) — dùng khi chọn mẫu reply
  // trong wizard gửi: toàn bộ khách của đợt gửi được gắn vào mẫu reply đã chọn.
  async linkCustomersToTemplate(templateId: string, customerIds: (string | number)[]) {
    if (!customerIds.length) return { linked: 0 };
    const r = await this.repo.linkCustomers(
      customerIds.map((cid) => ({ templateId: BigInt(templateId), customerId: BigInt(cid) })),
    );
    return { linked: r.count };
  }

  async listTemplateCustomers(templateId: string) {
    const links = await this.repo.findLinksWithCustomer(BigInt(templateId));
    return links.map((l) => l.customer);
  }

  async updateTemplate(id: string, input: UpdateTemplateInput) {
    const data: Record<string, unknown> = {};
    // Có khai tên mẫu Meta -> tra lại định nghĩa thật, tự set cờ Flow/ảnh (ghi đè phía dưới).
    const metaFlags = input.waTemplateName ? await this.detectMetaFlags(input.waTemplateName) : {};
    if (input.name !== undefined) data.name = input.name;
    if (input.subject !== undefined) data.subject = input.subject ?? null; // tên sản phẩm
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.body !== undefined || input.content !== undefined)
      data.body = input.body ?? input.content ?? null;
    if (input.channelId !== undefined) data.channelId = input.channelId ? BigInt(input.channelId) : null;
    if (input.waTemplateName !== undefined) data.waTemplateName = input.waTemplateName;
    if (input.waLanguage !== undefined) data.waLanguage = input.waLanguage;
    if (input.waCategory !== undefined) data.waCategory = input.waCategory ?? null;
    if (input.waImage !== undefined) data.waImage = input.waImage;
    if (input.waBodyParams !== undefined) data.waBodyParams = input.waBodyParams || null;
    if (input.sendAsText !== undefined) data.sendAsText = input.sendAsText;
    if (input.waFlow !== undefined) data.waFlow = input.waFlow;
    if (input.autoReply !== undefined) data.autoReply = input.autoReply;
    if (input.quotationId !== undefined)
      data.quotationId = input.quotationId ? BigInt(input.quotationId) : null;
    Object.assign(data, metaFlags); // cờ tự phát hiện từ Meta GHI ĐÈ giá trị tay
    const typed = data as Prisma.TemplateUncheckedUpdateInput;
    // Bật trả lời tự động cho mẫu này -> TẮT mọi mẫu khác (chỉ 1 mẫu reply active).
    if (input.autoReply === true) {
      return this.repo.updateExclusiveAutoReply(BigInt(id), typed);
    }
    return this.repo.update(BigInt(id), typed);
  }

  // Xóa template: xóa lệnh gửi liên quan rồi xóa template.
  // Link N-N (template_customers) tự bị xoá theo (onDelete: Cascade) — khách hàng giữ nguyên.
  async deleteTemplate(id: string) {
    const tid = BigInt(id);

    // CHẶN xoá khi còn tin CHƯA gửi. Xoá send_batches sẽ cascade xoá luôn send_jobs, nên trước đây
    // xoá 1 template đang chạy dở là bốc hơi cả hàng đợi mà không báo gì — lệnh 8.000 khách mới gửi
    // được 2.000 thì 6.000 tin còn lại biến mất không dấu vết. Muốn xoá thì phải Huỷ lệnh trước,
    // lúc đó job chuyển FAILED kèm lý do và người dùng biết mình vừa bỏ những tin nào.
    const pending = await this.repo.countPendingJobs(tid);
    if (pending > 0) {
      throw new Error(
        `Template này còn ${pending} tin chưa gửi trong hàng đợi. Vào màn Gửi báo giá huỷ lệnh đang chạy trước, rồi mới xoá template.`,
      );
    }

    await this.repo.deleteCascade(tid);
    return { ok: true };
  }

  // ---- Điều phối HTTP + audit ----

  async list(q: TemplateListQuery) {
    if (q.pool) return this.listPoolTemplates();
    // Có ?page hoặc ?search -> trả dạng phân trang; không có -> mảng toàn bộ.
    if (q.page !== undefined || q.search !== undefined) {
      return this.listTemplatesPaged({
        search: q.search ?? null,
        page: Number(q.page) || 1,
        limit: Number(q.limit) || 12,
        kind: q.kind ?? null,
      });
    }
    return this.listTemplates();
  }

  async create(req: ReqLike, body: unknown) {
    const input = createTemplateSchema.parse(body);
    const t = await this.createStandaloneTemplate(input);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_TAO',
      target: labelOf('template', t as unknown as Record<string, unknown>),
      note: input.waTemplateName ? `template Meta: ${input.waTemplateName}` : null,
    });
    return t;
  }

  async syncMeta(req: ReqLike) {
    const r = await this.metaSync.syncTemplatesFromMeta();
    await this.auditService.audit(req, {
      action: 'TEMPLATE_DONG_BO_META',
      target: 'WhatsApp Manager',
      note: `kiểm ${r.checked} template, cập nhật ${r.updated}, không thấy trên Meta ${r.notFound}`,
    });
    return r;
  }

  // Trả null nếu không có — controller quyết định 404.
  detail(id: string) {
    return this.getTemplateDetail(id);
  }

  async update(req: ReqLike, id: string, body: unknown) {
    const input = updateTemplateSchema.parse(body);
    const before = await this.auditService.snapshot('template', id);
    const r = await this.updateTemplate(id, input);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_SUA',
      target: labelOf('template', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(req: ReqLike, id: string) {
    const before = await this.auditService.snapshot('template', id);
    const r = await this.deleteTemplate(id);
    await this.auditService.audit(req, { action: 'TEMPLATE_XOA', target: labelOf('template', before, id) });
    return r;
  }

  customers(id: string) {
    return this.listTemplateCustomers(id);
  }

  // Tạo khách gắn thẳng vào template này.
  async createCustomerFor(req: ReqLike, id: string, body: unknown) {
    const input = createCustomerSchema.parse(body);
    const c = await this.customersSvc.createCustomer({ ...input, templateId: id });
    const t = await this.auditService.snapshot('template', id);
    await this.auditService.audit(req, {
      action: 'KHACH_HANG_TAO',
      target: labelOf('customer', c as unknown as Record<string, unknown>),
      note: `gắn vào template ${labelOf('template', t, id)}; ${diffSummary(null, input as Record<string, unknown>)}`,
    });
    return c;
  }

  // Gắn hàng loạt khách vào template (trùng bỏ qua). Body: { customerIds: string[] }.
  async link(req: ReqLike, id: string, body: unknown) {
    const b = body as { customerIds?: unknown } | null | undefined;
    const ids: string[] = Array.isArray(b?.customerIds) ? (b.customerIds as string[]) : [];
    const r = await this.linkCustomersToTemplate(id, ids);
    const t = await this.auditService.snapshot('template', id);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_GAN_KHACH',
      target: labelOf('template', t, id),
      note: `${ids.length} khách`,
    });
    return r;
  }

  // Gỡ hàng loạt khách khỏi template. Body: { customerIds: string[] }.
  async unlink(req: ReqLike, id: string, body: unknown) {
    const b = (body ?? {}) as { customerIds?: unknown };
    const ids: string[] = Array.isArray(b.customerIds) ? b.customerIds.map(String) : [];
    const r = await this.unlinkCustomersFromTemplate(id, ids);
    const t = await this.auditService.snapshot('template', id);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_GO_KHACH',
      target: labelOf('template', t, id),
      note: `${r.unlinked} khách`,
    });
    return r;
  }

  // Gắn 1 khách hiện có vào template (tạo link N-N).
  async addCustomer(req: ReqLike, id: string, customerId: string) {
    const r = await this.customersSvc.addCustomerToTemplate(id, customerId);
    const [t, c] = await Promise.all([
      this.auditService.snapshot('template', id),
      this.auditService.snapshot('customer', customerId),
    ]);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_GAN_KHACH',
      target: labelOf('template', t, id),
      note: labelOf('customer', c, customerId),
    });
    return r;
  }

  // Gỡ 1 khách khỏi template (xoá link, khách vẫn còn ở template khác).
  async removeCustomer(req: ReqLike, id: string, customerId: string) {
    const [t, c] = await Promise.all([
      this.auditService.snapshot('template', id),
      this.auditService.snapshot('customer', customerId),
    ]);
    const r = await this.customersSvc.removeCustomerFromTemplate(id, customerId);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_GO_KHACH',
      target: labelOf('template', t, id),
      note: labelOf('customer', c, customerId),
    });
    return r;
  }

  // Ảnh trên Storage -> redirect sang URL public; ảnh legacy trong DB -> trả bytes.
  async image(id: string): Promise<TemplateImageResult> {
    const meta = await this.getTemplateImageMeta(id);
    if (!meta) return { kind: 'notFound' };
    if (meta.storagePath) {
      return { kind: 'redirect', url: publicImageUrl(meta.storagePath) + `?t=${meta.updatedAt.getTime()}` };
    }
    const img = await this.getTemplateImage(id);
    if (!img) return { kind: 'notFound' };
    return { kind: 'bytes', mime: img.mime, data: img.data };
  }

  // Lưu ảnh: body RAW là bytes ảnh, mime lấy từ content-type.
  async setImage(req: ReqLike, id: string, contentType: string | undefined, body: unknown) {
    const mime = contentType || 'image/png';
    if (!mime.startsWith('image/')) throw new Error('File không phải ảnh.');
    const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (buf.byteLength === 0) throw new Error('Ảnh rỗng.');
    if (buf.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh quá lớn (tối đa 5MB).');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const r = await this.setTemplateImage(id, ab, mime);
    const t = await this.auditService.snapshot('template', id);
    await this.auditService.audit(req, {
      action: 'TEMPLATE_DOI_ANH',
      target: labelOf('template', t, id),
      note: `${mime}, ${Math.round(ab.byteLength / 1024)} KB`,
    });
    return r;
  }

  async clearImage(req: ReqLike, id: string) {
    const r = await this.clearTemplateImage(id);
    const t = await this.auditService.snapshot('template', id);
    await this.auditService.audit(req, { action: 'TEMPLATE_XOA_ANH', target: labelOf('template', t, id) });
    return r;
  }
}
