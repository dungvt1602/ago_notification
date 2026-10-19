import { prisma } from "@core/db/prisma";

// Chỉ giữ chữ số; khớp khách theo 9 số cuối (bỏ khác biệt +84 / 0 / mã vùng).
export function phoneKey(p?: string | null): string {
  const d = (p || "").replace(/\D/g, "");
  return d.slice(-9);
}

// Tìm customerId khớp SĐT gửi đến (so 9 số cuối với whatsappPhone/phone).
async function matchCustomerId(fromPhone: string): Promise<bigint | null> {
  const key = phoneKey(fromPhone);
  if (!key) return null;
  const customers = await prisma.customer.findMany({
    select: { id: true, whatsappPhone: true, phone: true },
  });
  const hit = customers.find(
    (c) => phoneKey(c.whatsappPhone) === key || phoneKey(c.phone) === key,
  );
  return hit ? hit.id : null;
}

// Tóm tắt nội dung tin nhắn đến để hiển thị (giống bot).
export function summarizeMessage(m: Record<string, unknown>): { kind: string; type: string; text: string } {
  const type = String(m?.type || "");
  const interactive = (m?.interactive || {}) as Record<string, unknown>;
  // Nút Flow trả về -> nfm_reply
  if (interactive?.type === "nfm_reply") {
    const nfm = (interactive.nfm_reply || {}) as Record<string, unknown>;
    return { kind: "flow_response", type, text: String(nfm?.response_json || nfm?.body || "[Flow] đã gửi") };
  }
  if (type === "text") return { kind: "message", type, text: String((m.text as Record<string, unknown>)?.body || "") };
  if (type === "button") return { kind: "message", type, text: String((m.button as Record<string, unknown>)?.text || "") };
  if (type === "interactive") {
    const br = (interactive.button_reply || {}) as Record<string, unknown>;
    const lr = (interactive.list_reply || {}) as Record<string, unknown>;
    return { kind: "message", type, text: String(br?.title || lr?.title || "[interactive]") };
  }
  return { kind: "message", type, text: `[${type || "?"}]` };
}

// Lưu 1 tin khách trả lời (idempotent theo waMessageId — Meta hay gửi lại).
export async function recordInbound(input: {
  waMessageId?: string | null;
  fromPhone: string; // WhatsApp: SĐT; Zalo: user_id
  fromName?: string | null; // tên hiển thị (Zalo)
  channel?: string; // WHATSAPP | ZALO (mặc định WHATSAPP)
  kind: string;
  type?: string | null;
  text?: string | null;
  raw?: unknown;
  receiveChannelId?: bigint | null; // kênh nhận đã khớp
}) {
  const channel = (input.channel || "WHATSAPP").toUpperCase();
  // Chỉ WhatsApp mới khớp khách theo SĐT. Zalo cho user_id (UID) nên bỏ qua (tránh khớp nhầm).
  const customerId = channel === "WHATSAPP" ? await matchCustomerId(input.fromPhone) : null;
  try {
    // Trả bản ghi vừa tạo (kèm tên/công ty khách) để báo sếp. Null nếu trùng (đã lưu trước đó).
    return await prisma.inboundMessage.create({
      data: {
        waMessageId: input.waMessageId ?? null,
        fromPhone: input.fromPhone,
        fromName: input.fromName ?? null,
        channel,
        customerId,
        receiveChannelId: input.receiveChannelId ?? null,
        kind: input.kind,
        type: input.type ?? null,
        text: input.text ?? null,
        raw: (input.raw as never) ?? undefined,
      },
      include: { customer: { select: { name: true, company: true, market: true } } },
    });
  } catch (err) {
    // Trùng waMessageId (unique) -> đã lưu trước đó, bỏ qua (không báo trùng, không phá webhook).
    if (err instanceof Error && err.message.includes("Unique")) return null;
    throw err;
  }
}

// Cập nhật trạng thái gửi khi Meta báo delivered/read/failed (khớp theo messageId).
// Khi FAILED kèm lý do -> lưu vào error để soi được tại sao giao không tới.
export async function updateDeliveryStatus(waMessageId: string, status: string, errorText?: string | null): Promise<void> {
  const s = status.toUpperCase(); // SENT | DELIVERED | READ | FAILED
  await prisma.sendJob.updateMany({
    where: { messageId: waMessageId },
    data: {
      status: s === "SENT" ? "SENT" : s,
      // FAILED do GIAO KHÔNG TỚI (Meta đã nhận rồi mới fail) -> KHÔNG gửi lại (retryCount=99),
      // tránh vòng lặp: gửi -> webhook fail -> gửi lại -> ... Kèm lý do Meta.
      ...(s === "FAILED" ? { retryCount: 99, ...(errorText ? { error: errorText } : {}) } : {}),
    },
  });
}

// ----- Đọc cho giao diện -----

// Phản hồi gần đây (kèm tên/công ty khách) — cho Tổng quan + Hộp thư.
export function listInbound(limit = 200) {
  return prisma.inboundMessage.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
    include: {
      customer: { select: { name: true, company: true } },
      receiveChannel: { select: { name: true, type: true } },
    },
  });
}
// (fromName, channel là field scalar nên tự có trong kết quả trên — không cần select thêm)

// Dọn phản hồi khách: xóa HẾT bản ghi quá `days` ngày (giống send_jobs, tránh phình DB).
export async function cleanupInbound(days = 3) {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const r = await prisma.inboundMessage.deleteMany({
    where: { receivedAt: { lt: before } },
  });
  return r.count;
}

// Thống kê phản hồi cho Tổng quan.
export async function replyStats() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [total, last7d, distinctRows] = await Promise.all([
    prisma.inboundMessage.count(),
    prisma.inboundMessage.count({ where: { receivedAt: { gte: since } } }),
    prisma.inboundMessage.findMany({ where: { customerId: { not: null } }, distinct: ["customerId"], select: { customerId: true } }),
  ]);
  return { total, last7d, customersReplied: distinctRows.length };
}
