import { prisma } from "@core/db/prisma";
import { graphGet } from "@core/lib/whatsapp";

// ĐỒNG BỘ ĐỊNH NGHĨA TEMPLATE TỪ META: server tự biết mẫu nào có nút FLOW hay URL,
// header có ảnh hay không -> set cờ waFlow/waImage đúng cho toàn bộ template trong DB,
// hết cảnh tích tay sai rồi dính #132018 / #131009.
//
// WABA ID tìm theo thứ tự: env WHATSAPP_WABA_ID -> API /me/assigned_whatsapp_business_accounts
// -> app_settings.waba_id (tự bắt từ webhook: mỗi event WhatsApp đều chứa entry.id = WABA).
// graphGet dùng chung (có timeout) lấy từ src/server/lib/whatsapp.ts.

// Lưu WABA id bắt được từ webhook (entry.id). Gọi fire-and-forget, không phá webhook.
let wabaCaptured = false; // đỡ ghi DB lặp trong cùng process
export async function captureWabaId(wabaId: string): Promise<void> {
  if (!wabaId || wabaCaptured) return;
  try {
    await prisma.appSetting.upsert({
      where: { key: "waba_id" },
      create: { key: "waba_id", value: wabaId },
      update: { value: wabaId },
    });
    wabaCaptured = true;
  } catch {
    // nuốt lỗi
  }
}

async function resolveWabaId(): Promise<string> {
  // 1) Env (chủ động khai)
  if (process.env.WHATSAPP_WABA_ID) return process.env.WHATSAPP_WABA_ID;
  // 2) API — chạy được khi System User đã được GÁN tài sản WABA trong Business Settings
  try {
    const d = await graphGet("/me/assigned_whatsapp_business_accounts");
    const first = (d.data as { id?: string }[] | undefined)?.[0]?.id;
    if (first) return first;
  } catch {
    // thử nguồn tiếp
  }
  // 3) Tự bắt từ webhook (entry.id) — có sau lần đầu khách nhắn/tin trạng thái về
  const row = await prisma.appSetting.findUnique({ where: { key: "waba_id" } });
  if (row?.value) return row.value;
  throw new Error(
    "Chưa tìm được WABA ID. Cách nhanh nhất: vào Business Settings -> System users -> AGO Quote WA -> " +
      "Add assets -> WhatsApp accounts -> gán tài khoản WhatsApp (full control). " +
      "Hoặc chờ 1 tin webhook về (khách nhắn) là hệ thống tự bắt được.",
  );
}

// ============================================================
// CHẤT LƯỢNG SỐ + HẠN MỨC (Việc 2) — đọc từ Meta, cache 10 phút.
// ============================================================

export type PhoneHealth = {
  phoneNumberId: string;
  displayPhoneNumber: string;
  qualityRating: string;      // GREEN | YELLOW | RED | NA (NA = chưa xác định)
  messagingLimitTier: string; // TIER_250 | TIER_2K | TIER_10K | ... (thang cấp portfolio)
  status: string;             // trạng thái số (CONNECTED...) — FLAGGED đã bị Meta bỏ từ 07/10/2025
  nameStatus: string;
  throughput: string;
  codeVerificationStatus: string;
  verifiedName: string;
  fetchedAt: string;          // ISO lúc fetch (để UI hiện "cập nhật lúc...")
};

const HEALTH_CACHE_MS = 10 * 60 * 1000;
let healthCache: { at: number; data: PhoneHealth | null } = { at: 0, data: null };

// Lấy phone_number_id: env trước, sau đó tới accountId của kênh WHATSAPP đang bật.
async function resolvePhoneNumberId(): Promise<string | null> {
  if (process.env.WHATSAPP_PHONE_NUMBER_ID) return process.env.WHATSAPP_PHONE_NUMBER_ID;
  const ch = await prisma.channel.findFirst({
    where: { type: "WHATSAPP", isActive: true },
    select: { accountId: true },
    orderBy: { id: "asc" },
  });
  return ch?.accountId ?? null;
}

// Đọc chất lượng số + hạn mức từ Meta. KHÔNG bao giờ ném lỗi ra ngoài: lỗi mạng -> trả cache cũ
// (nếu có), chưa có cache -> trả null. Màn Tổng quan không được sập vì Meta chậm.
export async function getPhoneNumberHealth(force = false): Promise<PhoneHealth | null> {
  if (!force && healthCache.data && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.data;
  try {
    const phoneNumberId = await resolvePhoneNumberId();
    if (!phoneNumberId) return null;
    const d = await graphGet(
      `/${phoneNumberId}?fields=quality_rating,messaging_limit_tier,status,name_status,throughput,code_verification_status,display_phone_number,verified_name`,
      { timeoutMs: 8000 },
    );
    const data: PhoneHealth = {
      phoneNumberId,
      displayPhoneNumber: String(d.display_phone_number ?? ""),
      qualityRating: String(d.quality_rating ?? "NA").toUpperCase(),
      messagingLimitTier: String(d.messaging_limit_tier ?? "").toUpperCase(),
      status: String(d.status ?? "").toUpperCase(),
      nameStatus: String(d.name_status ?? "").toUpperCase(),
      // throughput là OBJECT {level:"STANDARD"} chứ không phải chuỗi — String() thẳng sẽ ra
      // "[OBJECT OBJECT]". Lấy .level; Meta đổi kiểu trả về thì rơi về chuỗi rỗng.
      throughput: String((d.throughput as { level?: unknown } | null)?.level ?? "").toUpperCase(),
      codeVerificationStatus: String(d.code_verification_status ?? "").toUpperCase(),
      verifiedName: String(d.verified_name ?? ""),
      fetchedAt: new Date().toISOString(),
    };
    healthCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("[metaHealth] lấy chất lượng số thất bại:", err instanceof Error ? err.message : err);
    return healthCache.data; // lỗi mạng -> trả bản cũ (có thể null)
  }
}

type MetaButton = { type?: string };
type MetaComponent = { type?: string; format?: string; buttons?: MetaButton[] };
type MetaTemplate = { name?: string; language?: string; status?: string; components?: MetaComponent[] };

// Tải TOÀN BỘ mẫu từ Meta (phân trang) -> map name -> {hasFlow, hasUrl, hasImageHeader, status}.
async function fetchMetaTemplates(wabaId: string): Promise<Map<string, { hasFlow: boolean; hasImageHeader: boolean; buttons: string[]; status: string; language: string }>> {
  const map = new Map<string, { hasFlow: boolean; hasImageHeader: boolean; buttons: string[]; status: string; language: string }>();
  let path: string | null = `/${wabaId}/message_templates?fields=name,language,status,components&limit=100`;
  while (path) {
    const d = await graphGet(path);
    for (const t of (d.data as MetaTemplate[] | undefined) || []) {
      const comps = t.components || [];
      const header = comps.find((c) => (c.type || "").toUpperCase() === "HEADER");
      const btns = comps.find((c) => (c.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
      const types = btns.map((b) => (b.type || "").toUpperCase());
      // 1 tên mẫu có thể nhiều ngôn ngữ — ưu tiên bản APPROVED
      const existing = map.get(t.name || "");
      if (existing && existing.status === "APPROVED" && t.status !== "APPROVED") continue;
      map.set(t.name || "", {
        hasFlow: types.includes("FLOW"),
        hasImageHeader: (header?.format || "").toUpperCase() === "IMAGE",
        buttons: types,
        status: t.status || "",
        language: t.language || "",
      });
    }
    const next = (d.paging as { next?: string } | undefined)?.next;
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "") : null;
  }
  return map;
}

// Tra 1 mẫu theo TÊN trên Meta (dùng lúc tạo/sửa template trong app).
// - null        = KHÔNG tra được (chưa có WABA / lỗi mạng) -> caller giữ giá trị hiện có
// - found:false = tra được nhưng Meta KHÔNG có mẫu tên này (gõ sai tên)
export async function getMetaTemplateDef(name: string): Promise<{ found: boolean; hasFlow: boolean; hasImageHeader: boolean; status: string } | null> {
  let wabaId: string;
  try {
    wabaId = await resolveWabaId();
  } catch {
    return null;
  }
  try {
    const d = await graphGet(`/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,language,status,components&limit=20`);
    const exact = (((d.data as MetaTemplate[] | undefined) || [])).filter((t) => t.name === name);
    if (!exact.length) return { found: false, hasFlow: false, hasImageHeader: false, status: "" };
    const best = exact.find((t) => t.status === "APPROVED") || exact[0];
    const comps = best.components || [];
    const header = comps.find((c) => (c.type || "").toUpperCase() === "HEADER");
    const types = (comps.find((c) => (c.type || "").toUpperCase() === "BUTTONS")?.buttons || []).map((b) => (b.type || "").toUpperCase());
    return {
      found: true,
      hasFlow: types.includes("FLOW"),
      hasImageHeader: (header?.format || "").toUpperCase() === "IMAGE",
      status: best.status || "",
    };
  } catch {
    return null;
  }
}

// Đồng bộ: đối chiếu từng template trong app với định nghĩa Meta -> sửa cờ lệch.
export async function syncTemplatesFromMeta() {
  const wabaId = await resolveWabaId();
  const meta = await fetchMetaTemplates(wabaId);

  const templates = await prisma.template.findMany({
    where: { waTemplateName: { not: null } },
    select: { id: true, name: true, waTemplateName: true, waFlow: true, waImage: true },
  });

  const results: { template: string; metaName: string; buttons: string[]; changes: string[]; status: string }[] = [];
  let updated = 0;
  const notFound: string[] = [];

  for (const t of templates) {
    const m = meta.get(t.waTemplateName!);
    if (!m) {
      notFound.push(`${t.name} (${t.waTemplateName})`);
      continue;
    }
    const changes: string[] = [];
    const data: Record<string, boolean> = {};
    if (t.waFlow !== m.hasFlow) {
      data.waFlow = m.hasFlow;
      changes.push(`nút Flow: ${t.waFlow ? "BẬT" : "tắt"} -> ${m.hasFlow ? "BẬT" : "tắt"}`);
    }
    if (t.waImage !== m.hasImageHeader) {
      data.waImage = m.hasImageHeader;
      changes.push(`ảnh header: ${t.waImage ? "có" : "không"} -> ${m.hasImageHeader ? "có" : "không"}`);
    }
    if (Object.keys(data).length) {
      await prisma.template.update({ where: { id: t.id }, data });
      updated++;
    }
    results.push({ template: t.name, metaName: t.waTemplateName!, buttons: m.buttons, changes, status: m.status });
  }

  return { wabaId, totalMeta: meta.size, checked: templates.length, updated, notFound, results };
}
