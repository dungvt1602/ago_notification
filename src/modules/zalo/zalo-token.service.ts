import crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ZaloOaToken } from '@prisma/client';
import {
  isSharedZaloTokenConfigured,
  readSharedZaloToken,
  sharedZaloTokenError,
} from '@core/lib/zaloSharedToken';
import { ActivityService } from '../activity/activity.service';
import { ZaloTokenRepository } from './zalo-token.repository';

// Vòng đời token Zalo OA (OAuth v4) — mirror `token_refresher` của worker Go (xem docs/zalo-oa.md).
//
//   Lần đầu : luồng cấp quyền PKCE (màn "Zalo OA") -> admin OA bấm Đồng ý -> Zalo trả `code`
//             -> đổi code + code_verifier lấy access_token + refresh_token -> ghi bảng zalo_oa_tokens.
//             (hoặc bootstrap từ ZALO_OA_REFRESH_TOKEN nếu lấy token tay bằng curl)
//   Sau đó  : access_token sắp hết hạn (< 10 phút) -> đổi refresh_token lấy cặp MỚI, ghi đè DB.
//             Zalo vô hiệu refresh_token cũ ngay khi dùng -> phải ghi cặp mới NGAY, không được mất.
//
// Env cần: ZALO_APP_ID, ZALO_SECRET_KEY (Secret Key của APP — KHÁC secret webhook).
// Tuỳ chọn: ZALO_OA_ID (tự bắt từ callback/webhook nếu bỏ trống), ZALO_OA_REFRESH_TOKEN (bootstrap).

const OAUTH_TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const OAUTH_PERMISSION_URL = 'https://oauth.zaloapp.com/v4/oa/permission';
const REFRESH_AHEAD_MS = 10 * 60 * 1000; // còn < 10 phút -> làm mới (như worker Go)
const CHECK_EVERY_MS = 5 * 60 * 1000; // ensureZaloTokenFresh: tối đa 1 lần đọc DB / 5 phút

// Khoá PKCE tạm trong app_settings (chỉ sống trong lúc chờ admin OA bấm Đồng ý).
const KEY_PKCE_VERIFIER = 'zalo_pkce_verifier';
const KEY_PKCE_STATE = 'zalo_pkce_state';
const KEY_PKCE_AT = 'zalo_pkce_at';
const KEY_OA_ID = 'zalo_oa_id'; // OA id tự bắt được (từ callback / webhook)
const KEY_OA_NAME = 'zalo_oa_name'; // tên OA (nếu có quyền đọc thông tin OA)
const KEY_WEBHOOK_SEEN = 'zalo_webhook_last_at'; // lần cuối web này nhận webhook Zalo HỢP LỆ

export type ZaloTokenRow = ZaloOaToken;

type ZaloOAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: string | number;
  error?: number | string;
  error_name?: string;
  error_reason?: string;
  error_description?: string;
};

type OAuthTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type ZaloActorLike = { id?: string | null; name?: string | null } | null | undefined;

type OaInfoResp = {
  error?: number;
  message?: string;
  data?: { oa_id?: string | number; name?: string };
};

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function needsRefresh(row: { expiresAt: Date }): boolean {
  return row.expiresAt.getTime() - Date.now() < REFRESH_AHEAD_MS;
}

@Injectable()
export class ZaloTokenService {
  private readonly logger = new Logger(ZaloTokenService.name);

  // Trạng thái trong process (service là singleton nên tương đương biến module cũ).
  private oaIdCaptured = false;
  private webhookSeenAt = 0;
  // Khoá: nhiều request cùng lúc chỉ 1 luồng gọi Zalo (refresh_token dùng 1 lần).
  private refreshing: Promise<ZaloTokenRow> | null = null;
  private lastEnsureAt = 0;

  constructor(
    private readonly repo: ZaloTokenRepository,
    private readonly activity: ActivityService,
  ) {}

  // ---------- Cấu hình ----------

  zaloAppConfig() {
    return {
      appId: (process.env.ZALO_APP_ID || '').trim(),
      secretKey: (process.env.ZALO_SECRET_KEY || '').trim(),
      oaIdEnv: (process.env.ZALO_OA_ID || '').trim(),
      webhookSecret: (process.env.ZALO_WEBHOOK_SECRET || process.env.ZALO_OA_SECRET || '').trim(),
      bootstrapRefreshToken: (process.env.ZALO_OA_REFRESH_TOKEN || '').trim(),
      legacyStaticToken: (process.env.ZALO_OA_TOKEN_MAIN || '').trim(),
    };
  }

  private requireAppConfig() {
    const cfg = this.zaloAppConfig();
    if (!cfg.appId || !cfg.secretKey) {
      throw new Error(
        'Chưa cấu hình ZALO_APP_ID / ZALO_SECRET_KEY trong .env (lấy ở developers.zalo.me -> Cài đặt).',
      );
    }
    return cfg;
  }

  // ---------- app_settings helpers ----------

  private async getSetting(key: string): Promise<string> {
    try {
      const row = await this.repo.findSetting(key);
      return row?.value || '';
    } catch {
      return '';
    }
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.repo.upsertSetting(key, value);
  }

  private async delSetting(key: string): Promise<void> {
    await this.repo.deleteSetting(key);
  }

  // OA id: env -> app_settings (tự bắt) -> dòng token duy nhất trong DB.
  async resolveOaId(): Promise<string> {
    const env = this.zaloAppConfig().oaIdEnv;
    if (env) return env;
    const saved = await this.getSetting(KEY_OA_ID);
    if (saved) return saved;
    const row = await this.repo.findLatestOaId();
    return row?.oaId || '';
  }

  // Webhook / callback gọi để ghi nhớ OA id (1 lần, nuốt lỗi).
  async captureZaloOaId(oaId: string): Promise<void> {
    if (!oaId || this.oaIdCaptured) return;
    try {
      await this.setSetting(KEY_OA_ID, oaId);
      this.oaIdCaptured = true;
    } catch {
      // nuốt lỗi
    }
  }

  // Webhook gọi mỗi khi nhận sự kiện có chữ ký đúng — ghi mốc thời gian (tối đa 1 lần/phút).
  async markZaloWebhookSeen(): Promise<void> {
    if (Date.now() - this.webhookSeenAt < 60_000) return;
    this.webhookSeenAt = Date.now();
    try {
      await this.setSetting(KEY_WEBHOOK_SEEN, new Date().toISOString());
    } catch {
      // nuốt lỗi
    }
  }

  // ---------- Gọi Zalo OAuth ----------

  private async callOAuth(body: Record<string, string>): Promise<OAuthTokens> {
    const cfg = this.requireAppConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let data: ZaloOAuthResponse = {};
    try {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { secret_key: cfg.secretKey, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ app_id: cfg.appId, ...body }).toString(),
        signal: ctrl.signal,
      });
      data = (await res.json().catch(() => ({}))) as ZaloOAuthResponse;
    } finally {
      clearTimeout(timer);
    }
    // Zalo trả HTTP 200 kể cả khi lỗi -> phải soi body: có error != 0 hoặc thiếu access_token.
    const errCode = data.error != null ? Number(data.error) : 0;
    if (errCode !== 0 || !data.access_token || !data.refresh_token) {
      const why = [data.error_name, data.error_reason, data.error_description].filter(Boolean).join(' — ');
      throw new Error(`Zalo từ chối cấp token (error ${data.error ?? '?'})${why ? ': ' + why : ''}`);
    }
    // expires_in: Zalo trả CHUỖI giây ("90000") — tin số server trả, không hard-code 1 giờ.
    const expiresIn = Number(data.expires_in) || 3600;
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn };
  }

  private async saveTokens(oaId: string, t: OAuthTokens): Promise<ZaloTokenRow> {
    const expiresAt = new Date(Date.now() + t.expiresIn * 1000);
    const row = await this.repo.upsertTokens(oaId, t, expiresAt);
    await this.captureZaloOaId(oaId);
    return row;
  }

  // ---------- Luồng cấp quyền PKCE ----------

  // Sinh cặp PKCE + state, cất verifier vào app_settings, trả URL cấp quyền để admin OA mở.
  // code_challenge = BASE64URL(SHA256(code_verifier)) — RFC 7636.
  async startZaloOAuth(callbackUrl: string) {
    const cfg = this.requireAppConfig();
    if (!callbackUrl) throw new Error('Thiếu callback URL.');
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    await this.setSetting(KEY_PKCE_VERIFIER, verifier);
    await this.setSetting(KEY_PKCE_STATE, state);
    await this.setSetting(KEY_PKCE_AT, new Date().toISOString());

    const authUrl =
      `${OAUTH_PERMISSION_URL}?app_id=${encodeURIComponent(cfg.appId)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&state=${encodeURIComponent(state)}`;
    return { authUrl, callbackUrl, codeChallenge: challenge, state };
  }

  // Đổi `code` (Zalo trả về callback) lấy token, dùng đúng code_verifier đã cất.
  // `code` chỉ dùng được 1 lần và hết hạn sau vài phút -> gọi ngay khi nhận.
  async exchangeZaloCode(params: { code: string; oaId?: string | null; state?: string | null }) {
    const code = (params.code || '').trim();
    if (!code) throw new Error('Thiếu code.');
    const verifier = await this.getSetting(KEY_PKCE_VERIFIER);
    if (!verifier) {
      throw new Error("Không có code_verifier — hãy bấm 'Kết nối Zalo OA' để bắt đầu lại luồng cấp quyền.");
    }
    // state: chống giả mạo callback. Chỉ kiểm khi Zalo có gửi về (đổi code tay có thể bỏ trống).
    if (params.state) {
      const expect = await this.getSetting(KEY_PKCE_STATE);
      if (expect && params.state !== expect) {
        throw new Error('state không khớp — callback không phải từ luồng cấp quyền vừa tạo.');
      }
    }

    const tokens = await this.callOAuth({ grant_type: 'authorization_code', code, code_verifier: verifier });
    const oaId = (params.oaId || '').trim() || (await this.resolveOaId()) || 'default';
    const row = await this.saveTokens(oaId, tokens);
    // Verifier dùng 1 lần — xoá để code lộ (qua log/URL) cũng vô dụng.
    await Promise.all([
      this.delSetting(KEY_PKCE_VERIFIER),
      this.delSetting(KEY_PKCE_STATE),
      this.delSetting(KEY_PKCE_AT),
    ]);
    // Thử lấy tên OA (cần quyền "Lấy thông tin OA" — không có thì thôi).
    void this.fetchOaName(row.accessToken);
    await this.activity.logActivity({
      action: 'ZALO_KET_NOI',
      target: oaId,
      result: 'SUCCESS',
      note: `token hết hạn ${row.expiresAt.toISOString()}`,
    });
    return { oaId: row.oaId, expiresAt: row.expiresAt };
  }

  // ---------- Làm mới token ----------

  private async refreshRow(row: ZaloTokenRow): Promise<ZaloTokenRow> {
    try {
      const tokens = await this.callOAuth({ grant_type: 'refresh_token', refresh_token: row.refreshToken });
      const saved = await this.saveTokens(row.oaId, tokens);
      this.logger.log(
        `[zaloToken] đã làm mới access token Zalo OA oa_id=${row.oaId} expires_at=${saved.expiresAt.toISOString()}`,
      );
      return saved;
    } catch (err) {
      // Có thể tiến trình khác vừa làm mới xong (refresh_token cũ đã bị vô hiệu) -> đọc lại DB,
      // nếu dòng đã mới hơn thì dùng luôn thay vì báo lỗi.
      const latest = await this.repo.findTokenByOaId(row.oaId);
      if (
        latest &&
        latest.updatedAt > row.updatedAt &&
        latest.expiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS
      ) {
        return latest;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[zaloToken] làm mới token Zalo OA thất bại oa_id=${row.oaId}: ${msg}`);
      await this.activity.logActivity({
        action: 'ZALO_LAM_MOI_TOKEN',
        target: row.oaId,
        result: 'FAILED',
        note: msg,
      });
      throw err;
    }
  }

  // Lần đầu chưa có dòng token nào -> tạo từ ZALO_OA_REFRESH_TOKEN với expires_at = NGAY BÂY GIỜ
  // (coi như hết hạn) để lượt làm mới đầu tiên chạy luôn (đúng cách worker Go bootstrap).
  private async bootstrapFromEnv(): Promise<ZaloTokenRow | null> {
    const cfg = this.zaloAppConfig();
    if (!cfg.bootstrapRefreshToken) return null;
    const oaId = (await this.resolveOaId()) || 'default';
    const row = await this.repo.upsertBootstrap(oaId, cfg.bootstrapRefreshToken);
    this.logger.log(
      '[zaloToken] đã khởi tạo token Zalo OA từ ZALO_OA_REFRESH_TOKEN — từ nay tự làm mới (xoá biến này khỏi .env được rồi)',
    );
    return row;
  }

  private loadRow(oaId?: string | null): Promise<ZaloTokenRow | null> {
    if (oaId) return this.repo.findTokenByOaId(oaId);
    return this.repo.findLatestToken();
  }

  // Dùng chung cho getFreshZaloToken / forceRefreshZaloToken: chỉ 1 lượt làm mới tại một thời điểm.
  private startRefresh(row: ZaloTokenRow): Promise<ZaloTokenRow> {
    if (!this.refreshing) {
      this.refreshing = this.refreshRow(row).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  // Trả dòng token CÒN HẠN (tự làm mới nếu cần). Null nếu chưa kết nối Zalo OA.
  async getFreshZaloToken(oaId?: string | null): Promise<ZaloTokenRow | null> {
    let row = await this.loadRow(oaId);
    if (!row) row = await this.bootstrapFromEnv();
    if (!row) return null;
    if (!needsRefresh(row) && row.accessToken) return row;
    return this.startRefresh(row);
  }

  // Access token dùng để gọi API OA. Thứ tự:
  //   1) DÙNG CHUNG với worker Go (ZALO_TOKEN_SOURCE_DB_URL) — đọc từ DB Go, không tự làm mới
  //   2) DB riêng của web (tự làm mới bằng refresh_token)
  //   3) token tĩnh trong env (legacy)
  // Trả "" nếu không có gì -> caller tự quyết (no-op / báo lỗi).
  async resolveZaloAccessToken(apiKeyEnv?: string | null): Promise<string> {
    if (isSharedZaloTokenConfigured()) {
      const shared = await readSharedZaloToken();
      if (shared?.accessToken) return shared.accessToken;
      this.logger.warn(
        `[zaloToken] chế độ dùng chung nhưng chưa đọc được token từ DB Go: ${sharedZaloTokenError()}`,
      );
    }
    try {
      const row = await this.getFreshZaloToken();
      if (row?.accessToken) return row.accessToken;
    } catch (err) {
      this.logger.error(
        `[zaloToken] không lấy được token từ DB, thử token tĩnh env: ${err instanceof Error ? err.message : err}`,
      );
    }
    const envName = apiKeyEnv || 'ZALO_OA_TOKEN_MAIN';
    return (process.env[envName] || '').trim();
  }

  // Lấy token MỚI sau khi Zalo báo -216 (token đang cầm đã hỏng):
  //   dùng chung -> đọc lại DB Go bỏ cache (Go vừa xoay token); riêng -> ép đổi refresh_token.
  async getRefreshedZaloAccessToken(): Promise<string> {
    if (isSharedZaloTokenConfigured()) {
      const shared = await readSharedZaloToken(true);
      if (!shared?.accessToken) throw new Error(sharedZaloTokenError() || 'DB worker Go không có token.');
      return shared.accessToken;
    }
    return (await this.forceRefreshZaloToken()).accessToken;
  }

  // Ép làm mới ngay (nút "Làm mới token" ở màn Zalo OA).
  async forceRefreshZaloToken(actor?: ZaloActorLike): Promise<ZaloTokenRow> {
    if (isSharedZaloTokenConfigured()) {
      throw new Error('Đang dùng chung token với worker Go — worker Go làm mới, web này chỉ đọc.');
    }
    const row = await this.loadRow();
    if (!row) throw new Error('Chưa có token Zalo OA trong DB — hãy kết nối Zalo OA trước.');
    const r = await this.startRefresh(row);
    await this.activity.logActivity({
      userId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      action: 'ZALO_LAM_MOI_TOKEN',
      target: r.oaId,
      result: 'SUCCESS',
      note: `hết hạn ${r.expiresAt.toISOString()}`,
    });
    return r;
  }

  // Job nền / cron: kiểm hạn và làm mới nếu cần. Không ném lỗi. Tối đa 1 lần đọc DB / 5 phút.
  async ensureZaloTokenFresh(force = false): Promise<void> {
    if (isSharedZaloTokenConfigured()) return; // Go làm mới, không việc gì ở đây
    if (!force && Date.now() - this.lastEnsureAt < CHECK_EVERY_MS) return;
    this.lastEnsureAt = Date.now();
    try {
      await this.getFreshZaloToken();
    } catch (err) {
      this.logger.error(`[zaloToken] job làm mới lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---------- Thông tin OA (tuỳ chọn) ----------

  private async fetchOaName(accessToken: string): Promise<void> {
    try {
      const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
        headers: { access_token: accessToken },
      });
      const data = (await res.json().catch(() => ({}))) as OaInfoResp;
      if (data?.error === 0 && data.data?.name) await this.setSetting(KEY_OA_NAME, data.data.name);
    } catch {
      // không có quyền đọc thông tin OA -> bỏ qua
    }
  }

  // Nút "Kiểm tra kết nối" (admin): gọi Zalo thật bằng token đang có, trả tên OA. -216 -> thử làm mới 1 lần.
  async checkZaloConnection(): Promise<{ ok: boolean; oaName?: string; oaId?: string; error?: string }> {
    let token = await this.resolveZaloAccessToken();
    if (!token) return { ok: false, error: 'Chưa có token — hãy bấm Kết nối Zalo OA.' };
    const call = async (t: string) => {
      const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', { headers: { access_token: t } });
      return (await res.json().catch(() => ({}))) as OaInfoResp;
    };
    let data = await call(token);
    if (data?.error === -216) {
      try {
        token = await this.getRefreshedZaloAccessToken();
        data = await call(token);
      } catch (err) {
        return {
          ok: false,
          error: 'Token hỏng và không làm mới được: ' + (err instanceof Error ? err.message : String(err)),
        };
      }
    }
    if (data?.error === 0) {
      const name = data.data?.name || '';
      if (name) await this.setSetting(KEY_OA_NAME, name).catch(() => {});
      return { ok: true, oaName: name, oaId: data.data?.oa_id != null ? String(data.data.oa_id) : undefined };
    }
    return { ok: false, error: `${data?.message || 'Zalo từ chối'} (error ${data?.error ?? '?'})` };
  }

  // ---------- Trạng thái cho màn Zalo OA ----------

  async zaloStatus() {
    const cfg = this.zaloAppConfig();
    const now = Date.now();
    const [oaName, pkceAt, webhookSeen] = await Promise.all([
      this.getSetting(KEY_OA_NAME),
      this.getSetting(KEY_PKCE_AT),
      this.getSetting(KEY_WEBHOOK_SEEN),
    ]);
    const webhookLastAt = webhookSeen ? new Date(webhookSeen) : null;
    const config = {
      appId: cfg.appId ? cfg.appId : '',
      hasSecretKey: !!cfg.secretKey,
      hasWebhookSecret: !!cfg.webhookSecret,
      hasLegacyStaticToken: !!cfg.legacyStaticToken,
      hasBootstrapRefreshToken: !!cfg.bootstrapRefreshToken,
      hasSharedTokenSource: isSharedZaloTokenConfigured(),
      webhookForwardUrl: (process.env.ZALO_WEBHOOK_FORWARD_URL || '').trim(),
    };

    // Chế độ DÙNG CHUNG: trạng thái = dòng token trong DB worker Go.
    if (isSharedZaloTokenConfigured()) {
      const shared = await readSharedZaloToken(true);
      return {
        config,
        webhookLastAt,
        source: 'shared' as const,
        sharedError: sharedZaloTokenError(),
        connected: !!shared?.accessToken,
        oaId: shared?.oaId || cfg.oaIdEnv || '',
        oaName: oaName || '',
        expiresAt: shared?.expiresAt ?? null,
        updatedAt: shared?.updatedAt ?? null,
        createdAt: null,
        tokenValid: !!shared?.expiresAt && shared.expiresAt.getTime() > now,
        minutesLeft: shared?.expiresAt ? Math.round((shared.expiresAt.getTime() - now) / 60000) : null,
        pendingAuthSince: null,
      };
    }

    const row = await this.loadRow().catch(() => null);
    return {
      config,
      webhookLastAt,
      source: (row?.accessToken ? 'own' : 'none') as 'own' | 'none',
      sharedError: '',
      connected: !!row?.accessToken,
      oaId: row?.oaId || (await this.resolveOaId()) || '',
      oaName: oaName || '',
      expiresAt: row?.expiresAt ?? null,
      updatedAt: row?.updatedAt ?? null,
      createdAt: row?.createdAt ?? null,
      tokenValid: row ? row.expiresAt.getTime() > now : false,
      minutesLeft: row ? Math.round((row.expiresAt.getTime() - now) / 60000) : null,
      // Đang dở luồng cấp quyền (đã bấm Kết nối, chưa thấy callback về)
      pendingAuthSince: pkceAt || null,
    };
  }

  // Ngắt kết nối: xoá token khỏi DB (admin muốn kết nối OA khác / thu hồi).
  async disconnectZalo(actor?: ZaloActorLike): Promise<void> {
    await this.repo.deleteAllTokens();
    await Promise.all([
      this.delSetting(KEY_PKCE_VERIFIER),
      this.delSetting(KEY_PKCE_STATE),
      this.delSetting(KEY_PKCE_AT),
      this.delSetting(KEY_OA_NAME),
    ]);
    this.oaIdCaptured = false;
    await this.activity.logActivity({
      userId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      action: 'ZALO_NGAT_KET_NOI',
      result: 'SUCCESS',
    });
  }
}
