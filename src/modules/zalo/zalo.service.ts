import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import { listSharedZaloBindings } from '@core/lib/zaloSharedToken';
import { publicBaseUrl, type BaseUrlReq } from '@core/http/baseUrl';
import { sendZaloTo } from '@core/lib/zalo';
import { actorFromRequest, audit } from '@core/services/auditService';
import {
  checkZaloConnection,
  disconnectZalo,
  exchangeZaloCode,
  forceRefreshZaloToken,
  startZaloOAuth,
  zaloStatus,
} from '@core/services/zaloTokenService';
import { listZaloSenders } from '@core/services/zaloSenderService';

// Đường TAY: dán nguyên link (hoặc chỉ code) -> bóc code/oa_id/state.
function parseInput(raw: string): { code: string; oaId: string; state: string } {
  const s = (raw || '').trim();
  if (/[?&]code=/.test(s) || s.includes('://')) {
    try {
      const u = new URL(s.includes('://') ? s : 'https://x/?' + s.replace(/^\?/, ''));
      return {
        code: u.searchParams.get('code') || '',
        oaId: u.searchParams.get('oa_id') || '',
        state: u.searchParams.get('state') || '',
      };
    } catch {
      // rơi xuống dưới
    }
  }
  return { code: s, oaId: '', state: '' };
}

@Injectable()
export class ZaloService {
  // Người đã liên kết Zalo bên worker Go (chế độ dùng chung token), kèm cờ receiveChannel.
  async listSharedUsers() {
    const rows = await listSharedZaloBindings();
    const uids = rows.map((r) => r.zaloUserId).filter(Boolean);
    const channels = uids.length
      ? await prisma.receiveChannel.findMany({
          where: { type: 'ZALO', accountId: { in: uids } },
          select: { accountId: true, name: true, isActive: true },
        })
      : [];
    const byId = new Map(channels.map((c) => [c.accountId, { name: c.name, isActive: c.isActive }]));
    return rows.map((r) => ({ ...r, receiveChannel: byId.get(r.zaloUserId) ?? null }));
  }

  async status(req: BaseUrlReq) {
    const base = publicBaseUrl(req);
    const st = await zaloStatus();
    return {
      ...st,
      callbackUrl: (process.env.ZALO_OAUTH_CALLBACK_URL || '').trim() || `${base}/api/zalo/oauth/callback`,
      webhookUrl: `${base}/api/webhooks/zalo`,
      autoRefresh: process.env.SEND_WORKER_DISABLED !== 'true',
    };
  }

  async check(req: BaseUrlReq) {
    const r = await checkZaloConnection();
    await audit(req, {
      action: 'ZALO_KIEM_TRA',
      target: r.oaName || r.oaId || 'OA',
      result: r.ok ? 'SUCCESS' : 'FAILED',
      note: r.ok ? null : r.error || null,
    });
    if (!r.ok) throw new Error(r.error || 'Kết nối lỗi');
    return r;
  }

  async disconnect(req: BaseUrlReq) {
    await disconnectZalo(actorFromRequest(req));
    return { ok: true };
  }

  async refresh(req: BaseUrlReq) {
    const r = await forceRefreshZaloToken(actorFromRequest(req));
    return { oaId: r.oaId, expiresAt: r.expiresAt, updatedAt: r.updatedAt };
  }

  async test(req: BaseUrlReq, rawBody: unknown) {
    const body = (rawBody ?? {}) as { userId?: string; text?: string };
    const userId = (body.userId || '').trim();
    if (!userId) throw new Error('Nhập user_id / SĐT người nhận.');
    const r = await sendZaloTo(
      userId,
      (body.text || '').trim() || '✅ AGO báo giá: kết nối Zalo OA thành công.',
    );
    if (r.skipped) throw new Error('Chưa có token Zalo OA — hãy kết nối Zalo OA trước.');
    await audit(req, {
      action: 'ZALO_GUI_THU',
      target: userId,
      result: r.ok ? 'SUCCESS' : 'FAILED',
      note: r.ok ? null : r.error || 'gửi lỗi',
    });
    if (!r.ok) throw new Error(r.error || 'Gửi lỗi');
    return { ok: true };
  }

  async oauthStart(req: BaseUrlReq, rawBody: unknown) {
    const body = (rawBody ?? {}) as { callbackUrl?: string };
    const callbackUrl =
      (body.callbackUrl || '').trim() ||
      (process.env.ZALO_OAUTH_CALLBACK_URL || '').trim() ||
      `${publicBaseUrl(req)}/api/zalo/oauth/callback`;
    return startZaloOAuth(callbackUrl);
  }

  async oauthExchange(rawBody: unknown) {
    const body = (rawBody ?? {}) as { code?: string; url?: string; oaId?: string; state?: string };
    const parsed = parseInput(body.url || body.code || '');
    return exchangeZaloCode({
      code: parsed.code,
      oaId: (body.oaId || '').trim() || parsed.oaId || null,
      state: (body.state || '').trim() || parsed.state || null,
    });
  }

  // Zalo chuyển hướng trình duyệt admin về đây -> đổi code lấy token -> quay về màn Zalo OA.
  // Origin suy từ publicBaseUrl (ưu tiên APP_BASE_URL) thay cho req.nextUrl.origin của Next.
  async oauthCallback(
    req: BaseUrlReq,
    q: Record<string, string | undefined>,
  ): Promise<{ kind: 'redirect'; url: string }> {
    const code = q.code || '';
    const oaId = q.oa_id || '';
    const state = q.state || '';
    const back = new URL('/zalo-oa', publicBaseUrl(req));

    if (!code) {
      back.searchParams.set('zalo', 'err');
      back.searchParams.set('msg', 'Zalo không trả về code (admin OA chưa bấm Đồng ý?)');
      return { kind: 'redirect', url: back.toString() };
    }
    try {
      const r = await exchangeZaloCode({ code, oaId, state });
      back.searchParams.set('zalo', 'ok');
      back.searchParams.set('oa', r.oaId);
    } catch (err) {
      back.searchParams.set('zalo', 'err');
      back.searchParams.set('msg', err instanceof Error ? err.message : String(err));
    }
    return { kind: 'redirect', url: back.toString() };
  }

  senders() {
    return listZaloSenders();
  }
}
