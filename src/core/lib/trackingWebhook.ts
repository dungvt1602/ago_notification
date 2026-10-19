// Chuyển tiếp nút "Confirm Goods Received" sang hệ thống THEO DÕI ĐƠN HÀNG (backend Go).
//
// 1 app Meta chỉ có 1 Callback URL WhatsApp -> webhook trỏ về web báo giá này, còn nút xác nhận
// nhận hàng thuộc về hệ thống theo dõi đơn. Web này chuyển NGUYÊN VĂN raw body sang đó và KÝ LẠI bằng
// bí mật RIÊNG của hai hệ thống (TRACKING_RELAY_SECRET), KHÔNG chuyển X-Hub-Signature-256 của Meta và
// KHÔNG chia sẻ App Secret của Meta cho bên kia.
//
// Nói thẳng về mức bảo đảm: web này KHÔNG tự kiểm chữ ký của Meta (xem ghi chú ở README). Bên theo dõi
// đơn xác thực kênh chuyển tiếp bằng chữ ký HMAC riêng này (X-Tracking-Signature), còn việc "tin này có
// đúng là khách bấm không" dựa vào mã nút là một token ngẫu nhiên không đoán được ("ago:received:<token>").
//
// Chỉ chuyển tin là nút của hệ thống kia (payload "ago:received:<mã>", hoặc nhãn nút của template cũ).
// Trước đây mọi tin đến đều bị web này lưu + báo sếp + trả lời tự động -> tin nút của hệ thống kia
// không được rơi vào đó (khách bấm xác nhận mà nhận lại một tin trả lời tự động là sai).

import { createHmac } from "node:crypto";

export const TRACKING_BUTTON_PREFIX = "ago:received:";
const TRACKING_BUTTON_LABEL = "confirm goods received";
const FORWARD_TIMEOUT_MS = 10_000;

// Tên header chữ ký (viết thường như khi gọi fetch). Giá trị: "sha256=<hex thường>".
export const TRACKING_SIGNATURE_HEADER = "x-tracking-signature";

export type ForwardOutcome =
  | "ok" // bên kia nhận (2xx)
  | "rejected" // bên kia từ chối (4xx, vd sai chữ ký) — Meta gửi lại cũng vô ích
  | "retry"; // lỗi mạng / hết giờ / 5xx — cần Meta gửi lại

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// URL đích; rỗng = tính năng tắt (khi đó tin nút được xử lý như mọi tin đến khác).
export function trackingForwardUrl(): string {
  return (process.env.WHATSAPP_WEBHOOK_FORWARD_URL || "").trim();
}

// Bí mật dùng chung với backend theo dõi đơn (cùng giá trị ở biến TRACKING_RELAY_SECRET của backend).
export function trackingRelaySecret(): string {
  return (process.env.TRACKING_RELAY_SECRET || "").trim();
}

// Chữ ký của raw body: "sha256=" + HMAC-SHA256(secret, byte UTF-8 của rawBody) dạng hex thường.
// Hàm thuần — cùng đúng chuỗi body sẽ được gửi đi, không parse/stringify lại.
export function signTrackingBody(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

// Tin này là nút xác nhận của hệ thống theo dõi đơn?
// - nút template: type "button", button.payload = "ago:received:<noticeId>"
// - nút trả lời nhanh dạng interactive: button_reply.id cùng tiền tố
// - template CŨ không mang mã: nhãn nút đúng "Confirm Goods Received" (bên kia tự đối chiếu context.id)
export function isTrackingButtonMessage(m: Record<string, unknown>): boolean {
  const type = text(m?.type);
  if (type === "button") {
    const b = (m.button || {}) as Record<string, unknown>;
    return text(b.payload).startsWith(TRACKING_BUTTON_PREFIX) || text(b.text).trim().toLowerCase() === TRACKING_BUTTON_LABEL;
  }
  if (type === "interactive") {
    const br = (((m.interactive || {}) as Record<string, unknown>).button_reply || {}) as Record<string, unknown>;
    return text(br.id).startsWith(TRACKING_BUTTON_PREFIX);
  }
  return false;
}

export function classifyForwardStatus(status: number): ForwardOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400 && status < 500) return "rejected";
  return "retry";
}

// Gửi NGUYÊN VĂN body + chữ ký riêng (X-Tracking-Signature) sang hệ thống theo dõi đơn. Không bao giờ ném lỗi.
export async function forwardToTracking(rawBody: string): Promise<ForwardOutcome> {
  const url = trackingForwardUrl();
  if (!url) return "ok";
  const secret = trackingRelaySecret();
  if (!secret) {
    // Cấu hình thiếu: KHÔNG gửi tin không chữ ký. Trả "retry" -> route trả 503 -> Meta gửi lại khi chủ đặt
    // xong biến, xác nhận của khách không bị mất.
    console.error("[whatsappWebhook] đã bật WHATSAPP_WEBHOOK_FORWARD_URL nhưng thiếu TRACKING_RELAY_SECRET — không chuyển tiếp (sẽ để Meta gửi lại)");
    return "retry";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [TRACKING_SIGNATURE_HEADER]: signTrackingBody(rawBody, secret) },
      body: rawBody,
      signal: ctrl.signal,
    });
    const outcome = classifyForwardStatus(res.status);
    if (outcome !== "ok") console.warn("[whatsappWebhook] chuyển tiếp sang theo dõi đơn trả", res.status);
    return outcome;
  } catch (err) {
    console.warn("[whatsappWebhook] chuyển tiếp sang theo dõi đơn lỗi:", err instanceof Error ? err.message : err);
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}
