import { Injectable } from '@nestjs/common';
import {
  listTemplates,
  listTemplatesPaged,
  listPoolTemplates,
  createStandaloneTemplate,
  getTemplateDetail,
  updateTemplate,
  deleteTemplate,
  listTemplateCustomers,
  linkCustomersToTemplate,
  unlinkCustomersFromTemplate,
  getTemplateImage,
  getTemplateImageMeta,
  setTemplateImage,
  clearTemplateImage,
} from '@core/services/templateService';
import { CustomersService } from '../customers/customers.service';
import { syncTemplatesFromMeta } from '@core/services/metaSyncService';
import { createTemplateSchema, updateTemplateSchema } from '@core/validation/template.schema';
import { createCustomerSchema } from '@core/validation/customer.schema';
import { publicImageUrl } from '@core/lib/storage';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';
import type { ReqLike } from '@core/http/reqLike';

export type TemplateListQuery = Record<string, string | undefined>;

// Kết quả GET ảnh: controller dựng response thật từ đây.
export type TemplateImageResult =
  | { kind: 'notFound' }
  | { kind: 'redirect'; url: string }
  | { kind: 'bytes'; mime: string; data: Uint8Array };

@Injectable()
export class TemplatesService {
  constructor(private readonly customersSvc: CustomersService) {}

  async list(q: TemplateListQuery) {
    if (q.pool) return listPoolTemplates();
    // Có ?page hoặc ?search -> trả dạng phân trang; không có -> mảng toàn bộ.
    if (q.page !== undefined || q.search !== undefined) {
      return listTemplatesPaged({
        search: q.search ?? null,
        page: Number(q.page) || 1,
        limit: Number(q.limit) || 12,
        kind: q.kind ?? null,
      });
    }
    return listTemplates();
  }

  async create(req: ReqLike, body: unknown) {
    const input = createTemplateSchema.parse(body);
    const t = await createStandaloneTemplate(input);
    await audit(req, {
      action: 'TEMPLATE_TAO',
      target: labelOf('template', t as unknown as Record<string, unknown>),
      note: input.waTemplateName ? `template Meta: ${input.waTemplateName}` : null,
    });
    return t;
  }

  async syncMeta(req: ReqLike) {
    const r = await syncTemplatesFromMeta();
    await audit(req, {
      action: 'TEMPLATE_DONG_BO_META',
      target: 'WhatsApp Manager',
      note: `kiểm ${r.checked} template, cập nhật ${r.updated}, không thấy trên Meta ${r.notFound}`,
    });
    return r;
  }

  // Trả null nếu không có — controller quyết định 404.
  detail(id: string) {
    return getTemplateDetail(id);
  }

  async update(req: ReqLike, id: string, body: unknown) {
    const input = updateTemplateSchema.parse(body);
    const before = await snapshot('template', id);
    const r = await updateTemplate(id, input);
    await audit(req, {
      action: 'TEMPLATE_SUA',
      target: labelOf('template', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(req: ReqLike, id: string) {
    const before = await snapshot('template', id);
    const r = await deleteTemplate(id);
    await audit(req, { action: 'TEMPLATE_XOA', target: labelOf('template', before, id) });
    return r;
  }

  customers(id: string) {
    return listTemplateCustomers(id);
  }

  // Tạo khách gắn thẳng vào template này.
  async createCustomerFor(req: ReqLike, id: string, body: unknown) {
    const input = createCustomerSchema.parse(body);
    const c = await this.customersSvc.createCustomer({ ...input, templateId: id });
    const t = await snapshot('template', id);
    await audit(req, {
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
    const r = await linkCustomersToTemplate(id, ids);
    const t = await snapshot('template', id);
    await audit(req, {
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
    const r = await unlinkCustomersFromTemplate(id, ids);
    const t = await snapshot('template', id);
    await audit(req, {
      action: 'TEMPLATE_GO_KHACH',
      target: labelOf('template', t, id),
      note: `${r.unlinked} khách`,
    });
    return r;
  }

  // Gắn 1 khách hiện có vào template (tạo link N-N).
  async addCustomer(req: ReqLike, id: string, customerId: string) {
    const r = await this.customersSvc.addCustomerToTemplate(id, customerId);
    const [t, c] = await Promise.all([snapshot('template', id), snapshot('customer', customerId)]);
    await audit(req, {
      action: 'TEMPLATE_GAN_KHACH',
      target: labelOf('template', t, id),
      note: labelOf('customer', c, customerId),
    });
    return r;
  }

  // Gỡ 1 khách khỏi template (xoá link, khách vẫn còn ở template khác).
  async removeCustomer(req: ReqLike, id: string, customerId: string) {
    const [t, c] = await Promise.all([snapshot('template', id), snapshot('customer', customerId)]);
    const r = await this.customersSvc.removeCustomerFromTemplate(id, customerId);
    await audit(req, {
      action: 'TEMPLATE_GO_KHACH',
      target: labelOf('template', t, id),
      note: labelOf('customer', c, customerId),
    });
    return r;
  }

  // Ảnh trên Storage -> redirect sang URL public; ảnh legacy trong DB -> trả bytes.
  async image(id: string): Promise<TemplateImageResult> {
    const meta = await getTemplateImageMeta(id);
    if (!meta) return { kind: 'notFound' };
    if (meta.storagePath) {
      return { kind: 'redirect', url: publicImageUrl(meta.storagePath) + `?t=${meta.updatedAt.getTime()}` };
    }
    const img = await getTemplateImage(id);
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
    const r = await setTemplateImage(id, ab, mime);
    const t = await snapshot('template', id);
    await audit(req, {
      action: 'TEMPLATE_DOI_ANH',
      target: labelOf('template', t, id),
      note: `${mime}, ${Math.round(ab.byteLength / 1024)} KB`,
    });
    return r;
  }

  async clearImage(req: ReqLike, id: string) {
    const r = await clearTemplateImage(id);
    const t = await snapshot('template', id);
    await audit(req, { action: 'TEMPLATE_XOA_ANH', target: labelOf('template', t, id) });
    return r;
  }
}
