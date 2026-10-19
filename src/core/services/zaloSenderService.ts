import { prisma } from "@core/db/prisma";

// Người đã nhắn / quan tâm OA gần đây (từ inbound_messages channel=ZALO): user_id + tên hiển thị.
// Mục đích: admin cần user_id của sếp để thêm kênh nhận ZALO (đích báo sếp) — cách lấy user_id
// duy nhất là người đó nhắn cho OA rồi webhook trả sender.id về. Màn Zalo OA hiện danh sách này
// kèm nút "Thêm làm kênh nhận" để khỏi phải mò trong bảng Phản hồi.
export async function listZaloSenders(limit = 30) {
  const rows = await prisma.inboundMessage.findMany({
    where: { channel: "ZALO" },
    orderBy: { receivedAt: "desc" },
    take: 300,
    select: { fromPhone: true, fromName: true, text: true, type: true, receivedAt: true },
  });
  const existing = await prisma.receiveChannel.findMany({
    where: { type: "ZALO" },
    select: { accountId: true, name: true, isActive: true },
  });
  const byId = new Map(existing.map((c) => [c.accountId, c]));

  // Gom theo user_id, giữ tin mới nhất.
  const seen = new Map<string, { userId: string; name: string; lastText: string; lastType: string; lastAt: Date; count: number }>();
  for (const r of rows) {
    const cur = seen.get(r.fromPhone);
    if (cur) {
      cur.count++;
      if (!cur.name && r.fromName) cur.name = r.fromName;
      continue;
    }
    seen.set(r.fromPhone, {
      userId: r.fromPhone,
      name: r.fromName || "",
      lastText: r.text || "",
      lastType: r.type || "",
      lastAt: r.receivedAt,
      count: 1,
    });
  }
  return [...seen.values()].slice(0, limit).map((s) => {
    const ch = byId.get(s.userId);
    return { ...s, receiveChannel: ch ? { name: ch.name, isActive: ch.isActive } : null };
  });
}
