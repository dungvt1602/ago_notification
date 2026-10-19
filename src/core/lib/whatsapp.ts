import { isDryRun, dryRunMessageId } from "@core/lib/sendMode";

// Gửi 1 tin nhắn báo giá qua kênh. Trả { messageId } hoặc ném lỗi.
// - Chế độ gửi giả (mặc định) -> giả lập thành công, không gọi Meta. Quy tắc đọc SEND_DRY_RUN
//   nằm ở src/server/lib/sendMode.ts: phải ghi rõ false/0/no/off mới gửi thật.
// - WhatsApp: gửi bằng TEMPLATE đã duyệt (kèm ảnh header) nếu có, ngược lại gửi text.

export type WaTemplate = {
  templateName: string;
  language: string;
  mediaId?: string;
  includeImage: boolean;
  // Tham số body đã render sẵn. Có `name` = mẫu dùng biến có tên (Loại biến "Tên" trên
  // WhatsApp Manager) -> Meta bắt buộc gửi kèm `parameter_name`, thiếu là lỗi
  // "(#100) Parameter name is missing or empty".
  bodyParams?: { name?: string; value: string }[];
  hasFlowButton?: boolean; // template Meta có nút Flow -> gửi kèm component nút Flow (giống bot)
};

export type SendInput = {
  channelType: string; // WHATSAPP | ZALO | TELEGRAM
  apiKeyEnv?: string | null;
  accountId?: string | null;
  toPhone?: string | null;
  toName?: string | null;
  text: string; // nội dung text (khi không dùng WhatsApp template)
  wa?: WaTemplate | null;
};

// Chế độ gửi nằm ở src/server/lib/sendMode.ts (file thuần, test được ngoài Next). Re-export để
// mọi nơi — sendService, instrumentation, giao diện — dùng CHUNG một nguồn sự thật.
export { isDryRun };
const dryId = dryRunMessageId;
function apiVersion(): string {
  // v22.0 là bản dùng chung cho cả gửi tin lẫn tra template/phone number (metaSyncService).
  // Trước đây nơi gửi tin mặc định v20.0 còn metaSyncService mặc định v22.0 — đã thống nhất lại.
  return process.env.WHATSAPP_API_VERSION || "v22.0";
}

// fetch CÓ TIMEOUT: quá `ms` không phản hồi thì HỦY (throw) — chống 1 cuộc gọi mạng
// treo làm đơ cả worker gửi. Dùng globalThis.fetch để không tự đệ quy khi thay thế.
async function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// GET Graph API dùng chung (gửi tin + tra template + tra số điện thoại). Có timeout,
// token/version tham số hoá (mặc định WHATSAPP_TOKEN_MAIN + apiVersion()). Ném lỗi có cấu trúc.
export async function graphGet(
  path: string,
  opts: { token?: string; version?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const token = opts.token || process.env.WHATSAPP_TOKEN_MAIN;
  if (!token) throw new Error("Thiếu WHATSAPP_TOKEN_MAIN.");
  const version = opts.version || apiVersion();
  const res = await fetchWithTimeout(
    `https://graph.facebook.com/${version}${path}`,
    { headers: { authorization: `Bearer ${token}` } },
    opts.timeoutMs,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Graph API lỗi ${res.status}: ` + JSON.stringify((data as { error?: unknown })?.error || data).slice(0, 300));
  }
  return data;
}

// Upload ảnh lên WhatsApp -> trả media id (giống bot.uploadImageMedia).
export async function uploadWhatsAppMedia(opts: {
  token: string;
  phoneNumberId: string;
  bytes: ArrayBuffer;
  mime?: string;
  filename?: string;
}): Promise<string> {
  const mime = opts.mime || "image/png";
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([opts.bytes], { type: mime }), opts.filename || "quotation");

  const res = await fetchWithTimeout(`https://graph.facebook.com/${apiVersion()}/${opts.phoneNumberId}/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error("WhatsApp upload media lỗi: " + JSON.stringify(data));
  return data.id as string;
}

async function sendWhatsAppTemplate(opts: {
  token: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  mediaId?: string;
  includeImage: boolean;
  bodyParams: { name?: string; value: string }[];
  hasFlowButton?: boolean;
}): Promise<{ messageId: string }> {
  const components: unknown[] = [];
  if (opts.includeImage && opts.mediaId) {
    components.push({ type: "header", parameters: [{ type: "image", image: { id: opts.mediaId } }] });
  }
  if (opts.bodyParams.length) {
    components.push({
      type: "body",
      parameters: opts.bodyParams.map((p) => ({
        type: "text",
        ...(p.name ? { parameter_name: p.name } : {}),
        text: p.value,
      })),
    });
  }
  if (opts.hasFlowButton) {
    // Nút Flow: gửi kèm component button (giống bot). Payload tối giản chỉ cần flow_token,
    // chạy cho cả Flow loại Navigate lẫn Data-exchange. Thiếu -> Meta lỗi #131009 sub_type invalid.
    components.push({
      type: "button",
      sub_type: "flow",
      index: "0",
      parameters: [{ type: "action", action: { flow_token: `AGO_${opts.to}_${crypto.randomUUID()}` } }],
    });
  }
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.to,
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.language },
      ...(components.length ? { components } : {}),
    },
  };
  const res = await fetchWithTimeout(`https://graph.facebook.com/${apiVersion()}/${opts.phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    // Kèm payload đã gửi để soi được lệch chỗ nào (không chứa token).
    const sent = JSON.stringify(payload.template);
    console.error("[whatsapp] template bị từ chối. Payload gửi đi:", sent);
    throw new Error(
      "WhatsApp template lỗi: " + JSON.stringify(data?.error || data) + " | đã gửi: " + sent.slice(0, 600),
    );
  }
  return { messageId: data?.messages?.[0]?.id || "" };
}

export async function sendQuotationMessage(input: SendInput): Promise<{ messageId: string }> {
  if (isDryRun()) return { messageId: dryId() };

  const type = (input.channelType || "").toUpperCase();
  // Không gắn kênh -> mặc định lấy token từ WHATSAPP_TOKEN_MAIN.
  const token = process.env[input.apiKeyEnv || "WHATSAPP_TOKEN_MAIN"];

  if (type === "WHATSAPP") {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || input.accountId || "";
    if (!token || !phoneNumberId) {
      throw new Error("Thiếu WhatsApp token hoặc WHATSAPP_PHONE_NUMBER_ID.");
    }
    // Gửi bằng template đã duyệt (bắt buộc cho tin chủ động ngoài cửa sổ 24h)
    if (input.wa?.templateName) {
      return sendWhatsAppTemplate({
        token,
        phoneNumberId,
        to: input.toPhone!,
        templateName: input.wa.templateName,
        language: input.wa.language,
        mediaId: input.wa.mediaId,
        includeImage: input.wa.includeImage,
        bodyParams: input.wa.bodyParams ?? (input.toName ? [{ value: input.toName }] : []),
        hasFlowButton: input.wa.hasFlowButton,
      });
    }
    // Gửi text (chỉ hoạt động trong cửa sổ 24h)
    const res = await fetchWithTimeout(`https://graph.facebook.com/${apiVersion()}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: input.toPhone, type: "text", text: { body: input.text } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error("WhatsApp lỗi: " + JSON.stringify(data?.error || data));
    return { messageId: data?.messages?.[0]?.id || "" };
  }

  if (type === "TELEGRAM") {
    const chatId = input.toPhone || input.accountId || "";
    if (!token || !chatId) throw new Error("Thiếu Telegram bot token hoặc chat id.");
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: input.text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error("Telegram lỗi: " + JSON.stringify(data));
    return { messageId: String(data?.result?.message_id ?? "") };
  }

  throw new Error("Kênh chưa hỗ trợ gửi thật: " + type);
}
