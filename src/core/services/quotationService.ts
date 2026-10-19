import { prisma } from "@core/db/prisma";
import { computeTotal } from "@core/lib/placeholders";
import type { CreateQuotationInput, UpdateQuotationInput, ItemInput } from "@core/validation/quotation.schema";

// "2026-08-20" -> Date (nửa đêm UTC, cột kiểu @db.Date). Chuỗi rỗng -> null.
function toDate(v: string | null | undefined) {
  return v ? new Date(v) : null;
}

export function listQuotations() {
  return prisma.quotation.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { templates: true } } },
  });
}

// Mã tự sinh theo năm: BG-2026-0001, BG-2026-0002... (theo mã lớn nhất đang có).
async function nextQuotationCode() {
  const prefix = `BG-${new Date().getFullYear()}-`;
  const last = await prisma.quotation.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? Number(last.code.slice(prefix.length)) || 0 : 0;
  return prefix + String(n + 1).padStart(4, "0");
}

export async function createQuotation(input: CreateQuotationInput) {
  const code = input.code?.trim() || (await nextQuotationCode());
  return prisma.quotation.create({
    data: {
      code,
      title: input.title ?? null,
      totalAmount: (input.totalAmount ?? 0).toString(),
      currency: input.currency ?? "VND",
      status: input.status ?? "DRAFT",
      market: input.market ?? null,
      issuedDate: toDate(input.issuedDate),
      validUntil: toDate(input.validUntil),
    },
  });
}

// Sửa thông tin báo giá. Chỉ đụng vào field được gửi lên.
export function updateQuotation(id: string, input: UpdateQuotationInput) {
  const data: Record<string, unknown> = {};
  if (input.code !== undefined) data.code = input.code.trim();
  if (input.title !== undefined) data.title = input.title || null;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.status !== undefined) data.status = input.status;
  if (input.market !== undefined) data.market = input.market || null;
  if (input.issuedDate !== undefined) data.issuedDate = toDate(input.issuedDate);
  if (input.validUntil !== undefined) data.validUntil = toDate(input.validUntil);
  return prisma.quotation.update({ where: { id: BigInt(id) }, data });
}

export function getQuotationWithItems(id: string) {
  return prisma.quotation.findUnique({
    where: { id: BigInt(id) },
    include: { items: { orderBy: { no: "asc" } } },
  });
}

// Chi tiết đầy đủ 1 báo giá: sản phẩm + template thuộc về nó.
export function getQuotationDetail(id: string) {
  return prisma.quotation.findUnique({
    where: { id: BigInt(id) },
    include: {
      items: { orderBy: { no: "asc" } },
      templates: {
        orderBy: { createdAt: "asc" },
        include: {
          channel: { select: { type: true } },
          _count: { select: { customerLinks: true } },
        },
      },
      _count: { select: { templates: true } },
    },
  });
}

// Xóa báo giá: dọn lệnh gửi/jobs, gỡ template về kho, xóa items + gán user, rồi xóa báo giá.
export async function deleteQuotation(id: string) {
  const qid = BigInt(id);

  // CHẶN xoá khi còn tin CHƯA gửi — cùng lý do với deleteTemplate: xoá báo giá kéo theo cả
  // send_batches lẫn send_jobs, hàng đợi đang chạy dở sẽ bốc hơi im lặng.
  const pending = await prisma.sendJob.count({
    where: { batch: { quotationId: qid }, status: { in: ["QUEUED", "SENDING", "HOLD"] } },
  });
  if (pending > 0) {
    throw new Error(
      `Báo giá này còn ${pending} tin chưa gửi trong hàng đợi. Vào màn Gửi báo giá huỷ lệnh đang chạy trước, rồi mới xoá báo giá.`,
    );
  }

  const batches = await prisma.sendBatch.findMany({ where: { quotationId: qid }, select: { id: true } });
  const batchIds = batches.map((b) => b.id);
  await prisma.$transaction([
    ...(batchIds.length ? [prisma.sendJob.deleteMany({ where: { batchId: { in: batchIds } } })] : []),
    prisma.sendBatch.deleteMany({ where: { quotationId: qid } }),
    prisma.quotationTemplateSend.deleteMany({ where: { quotationId: qid } }),
    prisma.template.updateMany({ where: { quotationId: qid }, data: { quotationId: null } }),
    prisma.quotationItem.deleteMany({ where: { quotationId: qid } }),
    prisma.userQuotation.deleteMany({ where: { quotationId: qid } }),
    prisma.quotation.delete({ where: { id: qid } }),
  ]);
  return { ok: true };
}

export function listItems(quotationId: string) {
  return prisma.quotationItem.findMany({
    where: { quotationId: BigInt(quotationId) },
    orderBy: { no: "asc" },
  });
}

// Thay TOÀN BỘ mặt hàng + tự tính lại tổng tiền.
export async function setItems(quotationId: string, rawItems: ItemInput[]) {
  const qid = BigInt(quotationId);
  const items = rawItems
    .filter((it) => (it.product ?? "").trim())
    .map((it, i) => ({
      quotationId: qid,
      no: Number(it.no ?? i + 1),
      product: String(it.product ?? "").trim(),
      packing: it.packing ? String(it.packing) : null,
      unit: it.unit ? String(it.unit) : null,
      quantity: it.quantity != null ? String(it.quantity) : "1",
      price: it.price != null ? String(it.price) : "0",
      note: it.note ? String(it.note) : null,
    }));

  const total = computeTotal(items.map((it) => ({ quantity: it.quantity, price: it.price })));

  await prisma.$transaction([
    prisma.quotationItem.deleteMany({ where: { quotationId: qid } }),
    ...(items.length ? [prisma.quotationItem.createMany({ data: items })] : []),
    prisma.quotation.update({ where: { id: qid }, data: { totalAmount: total } }),
  ]);

  const saved = await prisma.quotationItem.findMany({ where: { quotationId: qid }, orderBy: { no: "asc" } });
  return { items: saved, totalAmount: total };
}
