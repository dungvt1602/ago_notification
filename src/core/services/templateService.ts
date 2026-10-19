import { prisma } from "@core/db/prisma";
import { createQuotation } from "@core/services/quotationService";
import type { CreateTemplateInput, UpdateTemplateInput } from "@core/validation/template.schema";
import {
  isStorageConfigured,
  templateImagePath,
  uploadImageToStorage,
  downloadImageFromStorage,
  deleteImageFromStorage,
} from "@core/lib/storage";
import { getMetaTemplateDef } from "@core/services/metaSyncService";

// TỰ PHÁT HIỆN cờ từ Meta theo tên mẫu (lúc tạo/sửa template) — người dùng KHỎI tích
// "có nút Flow" nữa. Tra không được (chưa WABA/lỗi mạng) -> {} giữ giá trị hiện có;
// Meta không có mẫu tên này -> ném lỗi (bắt gõ sai tên ngay lúc lưu).
async function detectMetaFlags(waTemplateName?: string | null): Promise<{ waFlow?: boolean; waImage?: boolean }> {
  if (!waTemplateName) return {};
  const def = await getMetaTemplateDef(waTemplateName);
  if (!def) return {};
  if (!def.found) {
    throw new Error(
      `Không tìm thấy mẫu "${waTemplateName}" trên Meta — kiểm tra lại tên (phải đúng y tên mẫu đã tạo trên WhatsApp Manager).`,
    );
  }
  return { waFlow: def.hasFlow, waImage: def.hasImageHeader };
}

export function listTemplates() {
  return prisma.template.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      quotation: { select: { id: true, code: true, title: true } },
      channel: { select: { id: true, name: true, type: true } },
      _count: { select: { customerLinks: true } },
    },
  });
}

// Danh sách template có phân trang + tìm kiếm (tên / tên template Meta / mã báo giá).
// Chịu được số lượng lớn (vd 1000 template) vì chỉ tải đúng 1 trang từ DB.
// Trả { items, total, page, limit }.
export async function listTemplatesPaged(params: {
  search?: string | null;
  page?: number;
  limit?: number;
  kind?: string | null; // "reply" = mẫu trả lời tự động | "send" = mẫu gửi báo giá | rỗng = tất cả
}) {
  const kw = (params.search || "").trim();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 12));
  const where = {
    ...(kw
      ? {
          OR: [
            { name: { contains: kw, mode: "insensitive" as const } },
            { waTemplateName: { contains: kw, mode: "insensitive" as const } },
            { quotation: { code: { contains: kw, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(params.kind === "reply" ? { autoReply: true } : params.kind === "send" ? { autoReply: false } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        quotation: { select: { id: true, code: true, title: true } },
        channel: { select: { id: true, name: true, type: true } },
        _count: { select: { customerLinks: true } },
      },
    }),
    prisma.template.count({ where }),
  ]);
  return { items, total, page, limit };
}

export function getTemplateDetail(id: string) {
  return prisma.template.findUnique({
    where: { id: BigInt(id) },
    include: {
      // Kèm mặt hàng + số template đang dùng chung: trang chi tiết template quản lý luôn báo giá.
      quotation: {
        select: {
          id: true, code: true, title: true, market: true, currency: true, totalAmount: true,
          status: true, validUntil: true, issuedDate: true,
          items: {
            orderBy: { no: "asc" },
            select: { id: true, no: true, product: true, packing: true, unit: true, quantity: true, price: true },
          },
          _count: { select: { templates: true } },
        },
      },
      channel: { select: { id: true, name: true, type: true, accountId: true } },
      image: { select: { mime: true, updatedAt: true } }, // chỉ lấy metadata, KHÔNG lấy bytes
      _count: { select: { customerLinks: true } },
    },
  });
}

// ---- Ảnh header của template (file trên Supabase Storage; DB chỉ giữ metadata) ----

// Metadata ảnh (KHÔNG kéo bytes). storagePath có = ảnh nằm trên Storage.
export function getTemplateImageMeta(id: bigint | number | string) {
  return prisma.templateImage.findUnique({
    where: { templateId: BigInt(id) },
    select: { mime: true, storagePath: true, updatedAt: true },
  });
}

// Lấy BYTES ảnh (để upload WhatsApp): ưu tiên Storage, fallback bytes DB (ảnh cũ legacy).
export async function getTemplateImage(id: bigint | number | string): Promise<{ data: Uint8Array; mime: string } | null> {
  const row = await prisma.templateImage.findUnique({ where: { templateId: BigInt(id) } });
  if (!row) return null;
  if (row.storagePath) {
    const ab = await downloadImageFromStorage(row.storagePath);
    if (ab) return { data: new Uint8Array(ab), mime: row.mime };
  }
  return row.data ? { data: new Uint8Array(row.data), mime: row.mime } : null;
}

// Chỉ kiểm tra CÓ ảnh hay không (không kéo bytes) — ảnh ~2MB, kéo mỗi vòng worker
// từng làm cháy 11.6GB egress Supabase/ngày. Bytes chỉ tải đúng lúc cần upload.
export async function hasTemplateImage(id: bigint | number | string): Promise<boolean> {
  const row = await prisma.templateImage.findUnique({
    where: { templateId: BigInt(id) },
    select: { mime: true },
  });
  return !!row;
}

// Lưu ảnh: Storage đã cấu hình -> upload path CỐ ĐỊNH (upsert = GHI ĐÈ ảnh cũ, không rác),
// DB chỉ giữ metadata (data=null). Chưa có SUPABASE_SERVICE_ROLE_KEY -> fallback bytes DB.
export async function setTemplateImage(id: string, data: ArrayBuffer, mime: string) {
  const templateId = BigInt(id);
  if (isStorageConfigured()) {
    const path = templateImagePath(id);
    await uploadImageToStorage(path, data, mime);
    await prisma.templateImage.upsert({
      where: { templateId },
      create: { templateId, data: null, storagePath: path, mime },
      update: { data: null, storagePath: path, mime },
    });
  } else {
    const bytes = new Uint8Array(data);
    await prisma.templateImage.upsert({
      where: { templateId },
      create: { templateId, data: bytes, mime },
      update: { data: bytes, mime },
    });
  }
  return { ok: true };
}

export async function clearTemplateImage(id: string) {
  const row = await prisma.templateImage.findUnique({
    where: { templateId: BigInt(id) },
    select: { storagePath: true },
  });
  if (row?.storagePath) await deleteImageFromStorage(row.storagePath);
  await prisma.templateImage.deleteMany({ where: { templateId: BigInt(id) } });
  return { ok: true };
}

export function listTemplatesByQuotation(quotationId: string) {
  return prisma.template.findMany({
    where: { quotationId: BigInt(quotationId) },
    orderBy: { createdAt: "asc" },
    include: {
      channel: { select: { id: true, name: true, type: true } },
      _count: { select: { customerLinks: true } },
    },
  });
}

export async function createTemplate(quotationId: string, input: CreateTemplateInput) {
  const metaFlags = await detectMetaFlags(input.waTemplateName);
  return prisma.template.create({
    data: {
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
    },
  });
}

// Tạo template — TỰ gắn kèm 1 báo giá mặc định (rỗng) để gửi được ngay, không phải
// vào chi tiết template gắn báo giá thủ công. Mỗi template có bảng giá riêng; sửa
// mặt hàng/giá của báo giá này trong trang chi tiết template.
export async function createStandaloneTemplate(input: CreateTemplateInput) {
  // Tra Meta TRƯỚC khi tạo báo giá kèm — gõ sai tên mẫu thì chặn ngay, không để báo giá mồ côi.
  const metaFlags = await detectMetaFlags(input.waTemplateName);
  const quotation = await createQuotation({
    title: input.name ? `Báo giá ${input.name}` : null,
  });
  return prisma.template.create({
    data: {
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
    },
  });
}

// Template trong kho (chưa gắn báo giá nào) — ứng viên để gắn vào 1 báo giá.
export function listPoolTemplates() {
  return prisma.template.findMany({
    where: { quotationId: null },
    orderBy: { createdAt: "desc" },
    include: {
      channel: { select: { id: true, name: true, type: true } },
      _count: { select: { customerLinks: true } },
    },
  });
}

// Gắn HÀNG LOẠT khách vào template (trùng thì bỏ qua) — dùng khi chọn mẫu reply
// trong wizard gửi: toàn bộ khách của đợt gửi được gắn vào mẫu reply đã chọn.
// Gỡ hàng loạt khách khỏi template (1 câu lệnh). Khách vẫn còn trong kho / template khác.
export async function unlinkCustomersFromTemplate(templateId: string, customerIds: (string | number)[]) {
  if (!customerIds.length) return { unlinked: 0 };
  const r = await prisma.templateCustomer.deleteMany({
    where: { templateId: BigInt(templateId), customerId: { in: customerIds.map((cid) => BigInt(cid)) } },
  });
  return { unlinked: r.count };
}

export async function linkCustomersToTemplate(templateId: string, customerIds: (string | number)[]) {
  if (!customerIds.length) return { linked: 0 };
  const r = await prisma.templateCustomer.createMany({
    data: customerIds.map((cid) => ({ templateId: BigInt(templateId), customerId: BigInt(cid) })),
    skipDuplicates: true,
  });
  return { linked: r.count };
}

export async function listTemplateCustomers(templateId: string) {
  const links = await prisma.templateCustomer.findMany({
    where: { templateId: BigInt(templateId) },
    orderBy: { createdAt: "asc" },
    include: { customer: true },
  });
  return links.map((l) => l.customer);
}

export async function updateTemplate(id: string, input: UpdateTemplateInput) {
  const data: Record<string, unknown> = {};
  // Có khai tên mẫu Meta -> tra lại định nghĩa thật, tự set cờ Flow/ảnh (ghi đè phía dưới).
  const metaFlags = input.waTemplateName ? await detectMetaFlags(input.waTemplateName) : {};
  if (input.name !== undefined) data.name = input.name;
  if (input.subject !== undefined) data.subject = input.subject ?? null; // tên sản phẩm
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.body !== undefined || input.content !== undefined) data.body = input.body ?? input.content ?? null;
  if (input.channelId !== undefined) data.channelId = input.channelId ? BigInt(input.channelId) : null;
  if (input.waTemplateName !== undefined) data.waTemplateName = input.waTemplateName;
  if (input.waLanguage !== undefined) data.waLanguage = input.waLanguage;
  if (input.waCategory !== undefined) data.waCategory = input.waCategory ?? null;
  if (input.waImage !== undefined) data.waImage = input.waImage;
  if (input.waBodyParams !== undefined) data.waBodyParams = input.waBodyParams || null;
  if (input.sendAsText !== undefined) data.sendAsText = input.sendAsText;
  if (input.waFlow !== undefined) data.waFlow = input.waFlow;
  if (input.autoReply !== undefined) data.autoReply = input.autoReply;
  if (input.quotationId !== undefined) data.quotationId = input.quotationId ? BigInt(input.quotationId) : null;
  Object.assign(data, metaFlags); // cờ tự phát hiện từ Meta GHI ĐÈ giá trị tay
  // Bật trả lời tự động cho mẫu này -> TẮT mọi mẫu khác (chỉ 1 mẫu reply active).
  if (input.autoReply === true) {
    return prisma.$transaction(async (tx) => {
      await tx.template.updateMany({ where: { id: { not: BigInt(id) }, autoReply: true }, data: { autoReply: false } });
      return tx.template.update({ where: { id: BigInt(id) }, data });
    });
  }
  return prisma.template.update({ where: { id: BigInt(id) }, data });
}

// Xóa template: xóa lệnh gửi liên quan rồi xóa template.
// Link N-N (template_customers) tự bị xoá theo (onDelete: Cascade) — khách hàng giữ nguyên.
export async function deleteTemplate(id: string) {
  const tid = BigInt(id);

  // CHẶN xoá khi còn tin CHƯA gửi. Xoá send_batches sẽ cascade xoá luôn send_jobs, nên trước đây
  // xoá 1 template đang chạy dở là bốc hơi cả hàng đợi mà không báo gì — lệnh 8.000 khách mới gửi
  // được 2.000 thì 6.000 tin còn lại biến mất không dấu vết. Muốn xoá thì phải Huỷ lệnh trước,
  // lúc đó job chuyển FAILED kèm lý do và người dùng biết mình vừa bỏ những tin nào.
  const pending = await prisma.sendJob.count({
    where: { batch: { templateId: tid }, status: { in: ["QUEUED", "SENDING", "HOLD"] } },
  });
  if (pending > 0) {
    throw new Error(
      `Template này còn ${pending} tin chưa gửi trong hàng đợi. Vào màn Gửi báo giá huỷ lệnh đang chạy trước, rồi mới xoá template.`,
    );
  }

  await prisma.$transaction([
    prisma.quotationTemplateSend.deleteMany({ where: { templateId: tid } }),
    prisma.sendBatch.deleteMany({ where: { templateId: tid } }),
    prisma.template.delete({ where: { id: tid } }),
  ]);
  return { ok: true };
}
