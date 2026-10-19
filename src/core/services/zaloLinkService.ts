import crypto from "crypto";
import { prisma } from "@core/db/prisma";
import { logActivity } from "@core/services/activityService";
import { zaloStatus } from "@core/services/zaloTokenService";

// KÍCH HOẠT ZALO cho người dùng — mirror luồng của worker Go (zalo_link_requests / zalo_user_bindings):
//   1) Người dùng bấm "Kích hoạt Zalo" -> app cấp mã 6 số, sống 10 phút (createZaloLinkCode)
//   2) Người dùng mở Zalo cá nhân, nhắn đúng mã đó cho OA
//   3) Webhook Zalo nhận user_send_text -> consumeZaloLinkCode: khớp mã -> gắn zalo user_id với tài khoản
//      + TỰ TẠO kênh nhận ZALO (receive_channels) -> notifyInboundReply đã có sẵn sẽ báo phản hồi khách về Zalo đó.
//   4) Mã dùng 1 lần, xoá ngay khi khớp.

const CODE_TTL_MS = 10 * 60 * 1000;

function sixDigits(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function displayName(u: { fullName: string | null; username: string }): string {
  return (u.fullName || "").trim() || u.username;
}

// Cấp mã kích hoạt cho user (ghi đè mã cũ nếu có). Trả mã + hạn + thông tin OA để hướng dẫn nhắn.
export async function createZaloLinkCode(userId: string) {
  const uid = BigInt(userId);
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, username: true, fullName: true } });
  if (!user) throw new Error("Không tìm thấy người dùng.");

  // Dọn mã hết hạn (mọi user) — nhẹ, tiện tay.
  await prisma.zaloLinkRequest.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  let code = sixDigits();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.zaloLinkRequest.findUnique({ where: { code }, select: { userId: true } });
    if (!clash || clash.userId === uid) break;
    code = sixDigits();
  }
  await prisma.zaloLinkRequest.upsert({
    where: { userId: uid },
    create: { userId: uid, code, expiresAt },
    update: { code, expiresAt },
  });
  const st = await zaloStatus();
  return { code, expiresAt, oaId: st.oaId, oaName: st.oaName, oaConnected: st.connected, userName: displayName(user) };
}

// Trạng thái kích hoạt của 1 user (cho modal + cột Zalo ở màn Người dùng).
export async function getZaloLinkStatus(userId: string) {
  const uid = BigInt(userId);
  const [binding, req, st] = await Promise.all([
    prisma.zaloUserBinding.findUnique({ where: { userId: uid } }),
    prisma.zaloLinkRequest.findUnique({ where: { userId: uid } }),
    zaloStatus(),
  ]);
  const pending = req && req.expiresAt.getTime() > Date.now() ? { expiresAt: req.expiresAt } : null;
  return {
    linked: !!binding && binding.status === "ACTIVE",
    zaloUserId: binding?.zaloUserId || "",
    zaloName: binding?.zaloName || "",
    linkedAt: binding?.linkedAt ?? null,
    pending,
    oaId: st.oaId,
    oaName: st.oaName,
    oaConnected: st.connected,
    tokenShared: st.source === "shared", // dùng chung token với worker Go
    webhookLastAt: st.webhookLastAt, // null = web này chưa từng nhận webhook -> mã nhắn vào OA sẽ không tới
  };
}

// Huỷ kích hoạt: xoá binding + xoá kênh nhận ZALO tương ứng (không còn báo về Zalo đó nữa).
export async function unlinkZalo(userId: string) {
  const uid = BigInt(userId);
  const binding = await prisma.zaloUserBinding.findUnique({ where: { userId: uid } });
  await prisma.zaloLinkRequest.deleteMany({ where: { userId: uid } });
  if (!binding) return { ok: true, removed: false };
  await prisma.$transaction([
    prisma.receiveChannel.deleteMany({ where: { type: "ZALO", accountId: binding.zaloUserId } }),
    prisma.zaloUserBinding.delete({ where: { userId: uid } }),
  ]);
  await logActivity({ userId: uid, action: "ZALO_HUY_KICH_HOAT", target: binding.zaloUserId, result: "SUCCESS" });
  return { ok: true, removed: true };
}

// Webhook gọi khi user nhắn OA: text là mã 6 số đang chờ -> gắn. Trả user đã gắn, hoặc null nếu không phải mã.
export async function consumeZaloLinkCode(text: string, zaloUserId: string, zaloName?: string | null) {
  const code = (text || "").trim();
  if (!/^\d{6}$/.test(code) || !zaloUserId) return null;
  const req = await prisma.zaloLinkRequest.findUnique({
    where: { code },
    include: { user: { select: { id: true, username: true, fullName: true } } },
  });
  if (!req) return null;
  if (req.expiresAt.getTime() < Date.now()) {
    await prisma.zaloLinkRequest.delete({ where: { userId: req.userId } }).catch(() => {});
    return null;
  }

  const name = displayName(req.user);
  await prisma.$transaction([
    // 1 Zalo chỉ gắn 1 tài khoản: nếu uid này đang gắn user khác -> gỡ user kia trước (unique zalo_user_id).
    prisma.zaloUserBinding.deleteMany({ where: { zaloUserId, NOT: { userId: req.userId } } }),
    prisma.zaloUserBinding.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, zaloUserId, zaloName: zaloName || null, status: "ACTIVE" },
      update: { zaloUserId, zaloName: zaloName || null, status: "ACTIVE", linkedAt: new Date() },
    }),
    // Kênh nhận ZALO = đích báo phản hồi khách. apiKeyEnv chỉ là fallback (token thật lấy từ DB).
    prisma.receiveChannel.upsert({
      where: { type_accountId: { type: "ZALO", accountId: zaloUserId } },
      create: {
        name: `Zalo — ${name}`,
        type: "ZALO",
        accountId: zaloUserId,
        apiKeyEnv: "ZALO_OA_TOKEN_MAIN",
        isActive: true,
        note: `Kích hoạt bởi ${req.user.username}`,
      },
      update: { name: `Zalo — ${name}`, isActive: true, note: `Kích hoạt bởi ${req.user.username}` },
    }),
    prisma.zaloLinkRequest.delete({ where: { userId: req.userId } }),
  ]);
  await logActivity({ userId: req.userId, actorName: name, action: "ZALO_KICH_HOAT", target: zaloUserId, result: "SUCCESS", note: zaloName || null });
  return { userId: req.userId, name, username: req.user.username };
}

// uid này có phải Zalo của một tài khoản đã kích hoạt không (để webhook không coi tin của nhân viên là phản hồi khách).
export async function isLinkedZaloUser(zaloUserId: string): Promise<boolean> {
  if (!zaloUserId) return false;
  const b = await prisma.zaloUserBinding.findUnique({ where: { zaloUserId }, select: { status: true } });
  return !!b && b.status === "ACTIVE";
}
