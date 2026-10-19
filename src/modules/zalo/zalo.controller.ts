import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { publicBaseUrl } from '@core/http/baseUrl';
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
import { ZaloService } from './zalo.service';

/*
 * Cổng từ Next: /api/zalo/{status,check,disconnect,refresh,test,senders,shared-users}
 * và /api/zalo/oauth/{start,exchange,callback}.
 */

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

@Controller('zalo')
export class ZaloController {
  constructor(private readonly zalo: ZaloService) {}

  @Get('status')
  status(@Req() req: Request) {
    return handle(async () => {
      const base = publicBaseUrl(webReq(req));
      const st = await zaloStatus();
      return {
        ...st,
        callbackUrl: (process.env.ZALO_OAUTH_CALLBACK_URL || '').trim() || `${base}/api/zalo/oauth/callback`,
        webhookUrl: `${base}/api/webhooks/zalo`,
        autoRefresh: process.env.SEND_WORKER_DISABLED !== 'true',
      };
    }, 500);
  }

  @Post('check')
  @HttpCode(200)
  check(@Req() req: Request) {
    return handle(async () => {
      const r = await checkZaloConnection();
      await audit(webReq(req), {
        action: 'ZALO_KIEM_TRA',
        target: r.oaName || r.oaId || 'OA',
        result: r.ok ? 'SUCCESS' : 'FAILED',
        note: r.ok ? null : r.error || null,
      });
      if (!r.ok) throw new Error(r.error || 'Kết nối lỗi');
      return r;
    });
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@Req() req: Request) {
    return handle(async () => {
      await disconnectZalo(actorFromRequest(webReq(req)));
      return { ok: true };
    });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request) {
    return handle(async () => {
      const r = await forceRefreshZaloToken(actorFromRequest(webReq(req)));
      return { oaId: r.oaId, expiresAt: r.expiresAt, updatedAt: r.updatedAt };
    });
  }

  @Post('test')
  @HttpCode(200)
  test(@Req() req: Request, @Body() rawBody: unknown) {
    return handle(async () => {
      const body = (rawBody ?? {}) as { userId?: string; text?: string };
      const userId = (body.userId || '').trim();
      if (!userId) throw new Error('Nhập user_id / SĐT người nhận.');
      const r = await sendZaloTo(userId, (body.text || '').trim() || '✅ AGO báo giá: kết nối Zalo OA thành công.');
      if (r.skipped) throw new Error('Chưa có token Zalo OA — hãy kết nối Zalo OA trước.');
      await audit(webReq(req), {
        action: 'ZALO_GUI_THU',
        target: userId,
        result: r.ok ? 'SUCCESS' : 'FAILED',
        note: r.ok ? null : r.error || 'gửi lỗi',
      });
      if (!r.ok) throw new Error(r.error || 'Gửi lỗi');
      return { ok: true };
    });
  }

  @Post('oauth/start')
  @HttpCode(200)
  oauthStart(@Req() req: Request, @Body() rawBody: unknown) {
    return handle(async () => {
      const body = (rawBody ?? {}) as { callbackUrl?: string };
      const callbackUrl =
        (body.callbackUrl || '').trim() ||
        (process.env.ZALO_OAUTH_CALLBACK_URL || '').trim() ||
        `${publicBaseUrl(webReq(req))}/api/zalo/oauth/callback`;
      return startZaloOAuth(callbackUrl);
    });
  }

  @Post('oauth/exchange')
  @HttpCode(200)
  oauthExchange(@Body() rawBody: unknown) {
    return handle(async () => {
      const body = (rawBody ?? {}) as { code?: string; url?: string; oaId?: string; state?: string };
      const parsed = parseInput(body.url || body.code || '');
      return exchangeZaloCode({
        code: parsed.code,
        oaId: (body.oaId || '').trim() || parsed.oaId || null,
        state: (body.state || '').trim() || parsed.state || null,
      });
    });
  }

  // Zalo chuyển hướng trình duyệt admin về đây -> đổi code lấy token -> quay về màn Zalo OA.
  // Origin suy từ publicBaseUrl(webReq(req)) (ưu tiên APP_BASE_URL) thay cho req.nextUrl.origin của Next.
  @Get('oauth/callback')
  async oauthCallback(
    @Req() req: Request,
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const code = q.code || '';
    const oaId = q.oa_id || '';
    const state = q.state || '';
    const back = new URL('/zalo-oa', publicBaseUrl(webReq(req)));

    if (!code) {
      back.searchParams.set('zalo', 'err');
      back.searchParams.set('msg', 'Zalo không trả về code (admin OA chưa bấm Đồng ý?)');
      res.redirect(307, back.toString());
      return;
    }
    try {
      const r = await exchangeZaloCode({ code, oaId, state });
      back.searchParams.set('zalo', 'ok');
      back.searchParams.set('oa', r.oaId);
    } catch (err) {
      back.searchParams.set('zalo', 'err');
      back.searchParams.set('msg', err instanceof Error ? err.message : String(err));
    }
    res.redirect(307, back.toString());
  }

  @Get('senders')
  senders() {
    return handle(() => listZaloSenders(), 500);
  }

  @Get('shared-users')
  sharedUsers() {
    return handle(() => this.zalo.listSharedUsers(), 500);
  }
}
