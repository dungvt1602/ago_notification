import crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ZaloTokenService } from './zalo-token.service';

// Gửi tin nhắn văn bản qua Zalo OA (Official Account) tới 1 hoặc nhiều user_id.
// Dùng cho THÔNG BÁO NỘI BỘ (vd báo sếp khi có phản hồi khách), không phải gửi báo giá.
//
// TOKEN: lấy qua ZaloTokenService — ưu tiên token trong DB (tự làm mới bằng refresh_token,
// xem màn "Zalo OA"), không có mới rơi về token tĩnh ZALO_OA_TOKEN_MAIN (legacy, chết sau ~1 ngày).
// Nếu Zalo báo -216 (access token không hợp lệ) -> ép làm mới 1 lần rồi gửi lại.
//
//   ZALO_BOSS_USER_ID  : user_id người nhận trên OA (nhiều người -> ngăn nhau bằng dấu phẩy).
//                        (fallback khi chưa khai kênh nhận ZALO trong DB)
// CHƯA cấu hình -> trả { skipped:true } (no-op) để app vẫn chạy; điền key sau là tự hoạt động.
//
// Lưu ý Zalo: gửi CS message cần người nhận đã tương tác với OA trong cửa sổ cho phép,
// và user_id là id theo OA (KHÔNG phải số điện thoại). Cần quyền "Gửi tin nhắn text" đã duyệt.

// Gốc API Zalo đọc lúc gọi (không chốt khi nạp module) để test trỏ sang Zalo GIẢ qua ZALO_API_BASE.
// Không đặt biến -> đúng https://openapi.zalo.me như trước.
const DEFAULT_ZALO_API_BASE = 'https://openapi.zalo.me';
function zaloApiBase(): string {
  return (process.env.ZALO_API_BASE || '').trim().replace(/\/+$/, '') || DEFAULT_ZALO_API_BASE;
}
const ERR_TOKEN_INVALID = -216;
const UID_CACHE_MS = 24 * 60 * 60 * 1000;

export type ZaloResult = { ok: boolean; skipped?: boolean; error?: string };

type ZaloApiResp = { error?: number; message?: string; data?: Record<string, unknown> };

function recipients(): string[] {
  return (process.env.ZALO_BOSS_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// fetch có timeout — 1 cuộc gọi treo không được làm đơ webhook/worker.
async function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikePhone(s: string): boolean {
  const d = s.replace(/\D/g, '');
  return /^\+?\d+$/.test(s.trim()) && d.length >= 9 && d.length <= 13; // user_id Zalo dài 15-19 số
}

function normalizePhone(s: string): string {
  let d = s.replace(/\D/g, '');
  if (d.startsWith('0')) d = '84' + d.slice(1);
  return d;
}

@Injectable()
export class ZaloClient {
  private readonly logger = new Logger(ZaloClient.name);

  // Người nhận có thể khai bằng SĐT Zalo thay vì user_id: tra SĐT -> user_id qua /oa/user/detail.
  // Cache 24h trong process để không tra lại mỗi tin.
  private readonly uidCache = new Map<string, { uid: string; at: number }>();

  constructor(private readonly token: ZaloTokenService) {}

  isZaloConfigured(): boolean {
    const cfg = this.token.zaloAppConfig();
    return (
      (!!cfg.legacyStaticToken ||
        (!!cfg.appId && !!cfg.secretKey) ||
        !!process.env.ZALO_TOKEN_SOURCE_DB_URL) &&
      recipients().length > 0
    );
  }

  // Chuyển tiếp NGUYÊN VĂN sự kiện webhook sang backend khác (worker Go) khi 2 hệ thống dùng chung 1 app Zalo
  // (1 app chỉ có 1 Webhook URL). Giữ đúng raw body + X-ZEvent-Signature nên bên kia vẫn verify được.
  // Fire-and-forget, không chặn trả 200 cho Zalo.
  forwardZaloWebhook(rawBody: string, macHeader: string | null): void {
    const url = (process.env.ZALO_WEBHOOK_FORWARD_URL || '').trim();
    if (!url) return;
    void fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(macHeader ? { 'x-zevent-signature': macHeader } : {}),
        },
        body: rawBody,
      },
      15000,
    )
      .then((r) => {
        if (!r.ok) this.logger.warn(`[zaloWebhook] chuyển tiếp sang ${url} trả ${r.status}`);
      })
      .catch((err) =>
        this.logger.warn(`[zaloWebhook] chuyển tiếp lỗi: ${err instanceof Error ? err.message : err}`),
      );
  }

  // Gọi 1 API OA bằng token đang có; nếu Zalo báo token hỏng (-216) thì làm mới rồi gọi lại đúng 1 lần.
  private async withZaloToken<T>(
    apiKeyEnv: string | null | undefined,
    fn: (token: string) => Promise<{ resp: ZaloApiResp; out: T }>,
  ): Promise<{ resp: ZaloApiResp; out: T } | null> {
    const token = await this.token.resolveZaloAccessToken(apiKeyEnv);
    if (!token) return null;
    const first = await fn(token);
    if (first.resp?.error !== ERR_TOKEN_INVALID) return first;
    try {
      const fresh = await this.token.getRefreshedZaloAccessToken();
      if (fresh === token) return first; // dùng chung: DB Go chưa có token mới -> không gọi lại vô ích
      return await fn(fresh);
    } catch (err) {
      this.logger.error(`[zalo] token -216 và làm mới cũng lỗi: ${err instanceof Error ? err.message : err}`);
      return first;
    }
  }

  private postCs(token: string, userId: string, text: string): Promise<{ resp: ZaloApiResp; out: boolean }> {
    return this.postCsMessage(token, userId, { text });
  }

  // Gửi 1 message bất kỳ (text / template) qua endpoint tin tư vấn.
  private async postCsMessage(
    token: string,
    userId: string,
    message: Record<string, unknown>,
  ): Promise<{ resp: ZaloApiResp; out: boolean }> {
    const res = await fetchWithTimeout(zaloApiBase() + '/v3.0/oa/message/cs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: token },
      body: JSON.stringify({ recipient: { user_id: userId }, message }),
    });
    // Zalo trả error=0 khi thành công; khác 0 hoặc HTTP lỗi = thất bại.
    const resp = (await res.json().catch(() => ({}))) as ZaloApiResp;
    const ok = res.ok && (typeof resp?.error !== 'number' || resp.error === 0);
    return { resp, out: ok };
  }

  async resolveZaloUserId(idOrPhone: string, apiKeyEnv?: string | null): Promise<string> {
    const raw = (idOrPhone || '').trim();
    if (!looksLikePhone(raw)) return raw;
    const phone = normalizePhone(raw);
    const hit = this.uidCache.get(phone);
    if (hit && Date.now() - hit.at < UID_CACHE_MS) return hit.uid;
    try {
      const r = await this.withZaloToken(apiKeyEnv, async (token) => {
        const url =
          zaloApiBase() +
          '/v3.0/oa/user/detail?data=' +
          encodeURIComponent(JSON.stringify({ user_id: phone }));
        const res = await fetchWithTimeout(url, { headers: { access_token: token } });
        const resp = (await res.json().catch(() => ({}))) as ZaloApiResp;
        return { resp, out: String(resp?.data?.user_id || '') };
      });
      if (r?.out) {
        this.uidCache.set(phone, { uid: r.out, at: Date.now() });
        return r.out;
      }
      const code = r?.resp?.error;
      this.logger.warn(`[zalo] không tra được user_id từ SĐT ${phone} : ${JSON.stringify(r?.resp || {})}`);
      // -232 "User hasn't interacted yet": người này chưa Quan tâm / chưa nhắn OA -> nói thẳng, đừng gửi bằng SĐT thô (sẽ ra -201 khó hiểu).
      if (code === -232 || code === -201) {
        throw new Error(
          `SĐT ${raw} chưa Quan tâm OA nên Zalo không cho nhắn. Nhờ người này mở Zalo → tìm OA AGO Fruit → bấm Quan tâm (hoặc nhắn 1 tin cho OA) rồi thử lại.`,
        );
      }
      throw new Error(`Không tra được user_id Zalo cho SĐT ${raw}: ${r?.resp?.message || 'lỗi ' + code}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('SĐT ')) throw err;
      if (err instanceof Error && err.message.startsWith('Không tra được')) throw err;
      this.logger.error(`[zalo] tra user_id từ SĐT lỗi: ${err instanceof Error ? err.message : err}`);
      throw new Error(`Không tra được user_id Zalo cho SĐT ${raw} (lỗi mạng). Thử lại sau.`);
    }
  }

  // Gửi tới 1 người nhận (user_id hoặc SĐT Zalo). `apiKeyEnv` = tên biến env token tĩnh (fallback khi DB chưa có token).
  async sendZaloTo(recipient: string, text: string, apiKeyEnv?: string | null): Promise<ZaloResult> {
    if (!recipient) return { ok: false, skipped: true };
    try {
      const userId = await this.resolveZaloUserId(recipient, apiKeyEnv);
      const r = await this.withZaloToken(apiKeyEnv, (t) => this.postCs(t, userId, text));
      if (!r) return { ok: false, skipped: true }; // chưa có token nào
      if (!r.out) {
        this.logger.error(`[zalo] gửi thất bại tới ${userId} : ${JSON.stringify(r.resp)}`);
        const code = r.resp?.error;
        const hint =
          code === -201 || code === -232
            ? ' — user_id không tồn tại hoặc người này chưa Quan tâm / chưa nhắn OA AGO Fruit.'
            : code === -213 || code === -214
              ? ' — app chưa được duyệt quyền "Gửi tin nhắn text" hoặc người nhận chưa tương tác OA.'
              : '';
        return {
          ok: false,
          error: (r.resp?.message ? `${r.resp.message} (error ${code})` : 'gửi lỗi') + hint,
        };
      }
      return { ok: true };
    } catch (err) {
      this.logger.error(`[zalo] lỗi mạng: ${err instanceof Error ? err.message : err}`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Gửi tin RFQ (đã dựng bởi buildRfqMessage) tới 1 user_id. KHÔNG ném lỗi: trả { ok, error?, resp, messageId? }.
  // `resp` là JSON thô của Zalo để nút "Nhắn thử" hiển thị chẩn đoán. Token/-216 xử lý như các tin khác.
  async sendRfqMessage(
    zaloUserId: string,
    message: Record<string, unknown>,
    apiKeyEnv?: string | null,
  ): Promise<{ ok: boolean; error?: string; resp?: unknown; messageId?: string }> {
    try {
      const r = await this.withZaloToken(apiKeyEnv, (t) => this.postCsMessage(t, zaloUserId, message));
      if (!r) return { ok: false, error: 'Chưa có token Zalo OA — hãy kết nối Zalo OA.' };
      if (!r.out) {
        const code = r.resp?.error;
        const hint =
          code === -201 || code === -232
            ? ' — user_id không tồn tại hoặc người này chưa Quan tâm / chưa nhắn OA.'
            : code === -213 || code === -214
              ? ' — app chưa được duyệt quyền gửi tin hoặc người nhận chưa tương tác OA (cửa sổ 48h).'
              : '';
        this.logger.warn(`[zalo] gửi RFQ thất bại tới ${zaloUserId} : ${JSON.stringify(r.resp)}`);
        return {
          ok: false,
          resp: r.resp,
          error: (r.resp?.message ? `${r.resp.message} (error ${code})` : 'Zalo từ chối tin') + hint,
        };
      }
      const mid = r.resp?.data?.message_id;
      return { ok: true, resp: r.resp, messageId: mid == null ? undefined : String(mid) };
    } catch (err) {
      this.logger.error(`[zalo] lỗi mạng khi gửi RFQ: ${err instanceof Error ? err.message : err}`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Gửi 1 đoạn text tới từng người nhận trong ZALO_BOSS_USER_ID. KHÔNG BAO GIỜ ném lỗi.
  async sendZaloText(text: string): Promise<ZaloResult> {
    const to = recipients();
    if (to.length === 0) return { ok: false, skipped: true }; // chưa cấu hình -> bỏ qua
    let anyFail = false;
    let skipped = true;
    for (const userId of to) {
      const r = await this.sendZaloTo(userId, text);
      if (!r.skipped) skipped = false;
      if (!r.ok && !r.skipped) anyFail = true;
    }
    if (skipped) return { ok: false, skipped: true };
    return anyFail ? { ok: false, error: 'một số người nhận gửi lỗi' } : { ok: true };
  }

  // Verify chữ ký webhook Zalo: mac = SHA256(appId + rawBody + timestamp + WebhookSecret).
  // - Truyền RAW body (chuỗi gốc Zalo gửi), KHÔNG JSON.stringify lại (đổi byte -> sai mac).
  // - Secret là "Secret Key" ở mục WEBHOOK của app (ZALO_WEBHOOK_SECRET) — KHÁC ZALO_SECRET_KEY.
  // - Header X-ZEvent-Signature có tiền tố "mac=" -> cắt trước khi so.
  // Chưa khai secret -> trả true (bỏ qua verify, để dev/local vẫn nhận được).
  verifyZaloSignature(rawBody: string, timestamp: string, macHeader?: string | null): boolean {
    const { webhookSecret, appId } = this.token.zaloAppConfig();
    if (!webhookSecret) return true; // chưa cấu hình -> không chặn
    if (!macHeader) return false;
    const expect = crypto
      .createHash('sha256')
      .update(appId + rawBody + timestamp + webhookSecret)
      .digest('hex');
    const got = macHeader.replace(/^mac=/i, '').trim().toLowerCase();
    return got === expect.toLowerCase();
  }

  // Lấy tên hiển thị của user Zalo theo UID (vì webhook không trả SĐT).
  // Lỗi/chưa cấu hình -> trả "" (không phá luồng nhận).
  async getZaloProfile(userId: string, apiKeyEnv?: string | null): Promise<string> {
    if (!userId) return '';
    try {
      const r = await this.withZaloToken(apiKeyEnv, async (token) => {
        const url =
          zaloApiBase() +
          '/v3.0/oa/user/detail?data=' +
          encodeURIComponent(JSON.stringify({ user_id: userId }));
        const res = await fetchWithTimeout(url, { headers: { access_token: token } });
        const resp = (await res.json().catch(() => ({}))) as ZaloApiResp;
        return { resp, out: String(resp?.data?.display_name || '') };
      });
      return r?.out || '';
    } catch (err) {
      this.logger.error(`[zalo] getZaloProfile lỗi: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }
}
