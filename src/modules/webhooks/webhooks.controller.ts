import { Controller, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { recordInbound, summarizeMessage, updateDeliveryStatus } from '@core/services/inboundService';
import { notifyInboundReply } from '@core/services/notificationService';
import { maybeAutoReply } from '@core/services/autoReplyService';
import { captureWabaId } from '@core/services/metaSyncService';
import { forwardToTracking, isTrackingButtonMessage, trackingForwardUrl } from '@core/lib/trackingWebhook';
import { verifyZaloSignature, getZaloProfile, sendZaloTo, forwardZaloWebhook } from '@core/lib/zalo';
import { captureZaloOaId, markZaloWebhookSeen } from '@core/services/zaloTokenService';
import { consumeZaloLinkCode, isLinkedZaloUser } from '@core/services/zaloLinkService';

/*
 * Cổng từ Next: GET/POST /api/webhooks/whatsapp và GET/POST /api/webhooks/zalo.
 * POST đọc RAW body (req.rawBody) vì chuỗi gốc được ký / chuyển tiếp nguyên văn.
 * Luôn trả đúng như bản Next (200 {ok:true} kể cả chữ ký sai; 503 {ok:false} khi tracking cần gửi lại).
 */

// Tóm tắt nội dung theo loại sự kiện Zalo.
function summarizeZalo(eventName: string, message: Record<string, unknown>): string {
  if (eventName === 'user_send_text') return String(message?.text || '');
  if (eventName === 'user_send_image') return '[Ảnh]';
  if (eventName === 'user_send_sticker') return '[Sticker]';
  if (eventName === 'user_send_file') return '[Tệp]';
  if (eventName === 'user_send_gif') return '[GIF]';
  if (eventName === 'user_send_audio') return '[Âm thanh]';
  if (eventName === 'user_send_video') return '[Video]';
  if (eventName === 'user_send_location') return '[Vị trí]';
  if (eventName === 'user_send_link') return String(message?.text || '[Liên kết]');
  return String(message?.text || `[${eventName}]`);
}

function rawOf(req: RawBodyRequest<Request>): string {
  return req.rawBody ? req.rawBody.toString('utf8') : '';
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('webhooks');

  // Bước xác minh của Meta: trả lại hub.challenge nếu verify_token khớp.
  @Get('whatsapp')
  whatsappVerify(@Query() q: Record<string, string | undefined>, @Res() res: Response): void {
    const mode = q['hub.mode'] ?? null;
    const token = q['hub.verify_token'] ?? null;
    const challenge = q['hub.challenge'] || '';
    const expected = process.env.WHATSAPP_VERIFY_TOKEN || '';

    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).type('text/plain').send('forbidden');
  }

  // Nhận sự kiện: tin khách trả lời + trạng thái gửi. LUÔN 200 (trừ 503 để tracking gửi lại).
  @Post('whatsapp')
  @HttpCode(200)
  async whatsappEvent(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const raw = rawOf(req);
    let body: unknown = {};
    try {
      body = JSON.parse(raw);
    } catch {
      res.status(200).json({ ok: true });
      return;
    }

    const forwardEnabled = !!trackingForwardUrl();
    let hasTrackingButton = false;

    try {
      const entries = Array.isArray((body as { entry?: unknown[] }).entry)
        ? (body as { entry: unknown[] }).entry
        : [];
      for (const entry of entries) {
        await captureWabaId(String((entry as { id?: unknown }).id || ''));
        const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
          ? (entry as { changes: unknown[] }).changes
          : [];
        for (const change of changes) {
          const value = ((change as { value?: unknown }).value || {}) as Record<string, unknown>;

          // Trạng thái gửi: sent/delivered/read/failed -> cập nhật send_jobs theo messageId.
          const statuses = Array.isArray(value.statuses) ? (value.statuses as Record<string, unknown>[]) : [];
          for (const st of statuses) {
            const id = String(st?.id || '');
            const status = String(st?.status || '');
            let errText: string | null = null;
            const errs = Array.isArray(st?.errors) ? (st.errors as Record<string, unknown>[]) : [];
            if (status === 'failed' && errs.length) {
              const e = errs[0] as {
                code?: unknown;
                title?: unknown;
                message?: unknown;
                error_data?: { details?: unknown };
              };
              const detail = e.error_data?.details || e.message || '';
              errText = `[${e.code ?? '?'}] ${e.title ?? ''}${detail ? ' — ' + detail : ''}`.trim();
            }
            if (id && status) await updateDeliveryStatus(id, status, errText);
          }

          // Tên hiển thị WhatsApp của người gửi (pushname).
          const contacts = Array.isArray(value.contacts) ? (value.contacts as Record<string, unknown>[]) : [];
          const profileName = String((contacts[0]?.profile as Record<string, unknown> | undefined)?.name || '');

          // Tin khách gửi đến (trả lời / bấm nút Flow).
          const messages = Array.isArray(value.messages) ? (value.messages as Record<string, unknown>[]) : [];
          for (const m of messages) {
            if (forwardEnabled && isTrackingButtonMessage(m)) {
              hasTrackingButton = true;
              continue;
            }
            const s = summarizeMessage(m);
            const saved = await recordInbound({
              waMessageId: String(m?.id || '') || null,
              fromPhone: String(m?.from || ''),
              fromName: profileName || null,
              kind: s.kind,
              type: s.type,
              text: s.text,
              raw: m,
            });
            if (saved) {
              await notifyInboundReply(saved);
              await maybeAutoReply(saved);
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`[whatsappWebhook] error: ${err instanceof Error ? err.stack : String(err)}`);
    }

    // Chuyển tiếp SAU xử lý cục bộ; lỗi mạng / hết giờ / 5xx -> 503 để Meta gửi lại.
    if (hasTrackingButton && (await forwardToTracking(raw)) === 'retry') {
      res.status(503).json({ ok: false });
      return;
    }

    res.status(200).json({ ok: true });
  }

  // Zalo không dùng hub.challenge; GET chỉ để kiểm tra endpoint sống.
  @Get('zalo')
  zaloPing(@Res() res: Response): void {
    res.status(200).type('text/plain').send('ok');
  }

  @Post('zalo')
  @HttpCode(200)
  async zaloEvent(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const raw = rawOf(req);
    const macHeader = req.headers['x-zevent-signature'];
    const mac = Array.isArray(macHeader) ? macHeader.join(', ') : (macHeader ?? null);
    // Dùng chung app Zalo với worker Go -> chuyển tiếp MỌI sự kiện sang bên đó.
    forwardZaloWebhook(raw, mac);

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: true }; // request thử kết nối / payload lạ -> 200, không làm gì
    }

    const timestamp = String(body?.timestamp || '');
    if (!verifyZaloSignature(raw, timestamp, mac)) {
      this.logger.warn(
        '[zaloWebhook] chữ ký không hợp lệ — bỏ qua (kiểm ZALO_WEBHOOK_SECRET có đúng ô Secret Key ở trang Webhook không)',
      );
      return { ok: true };
    }

    void markZaloWebhookSeen();

    try {
      const eventName = String(body?.event_name || '');
      const sender = (body?.sender || {}) as Record<string, unknown>;
      const recipient = (body?.recipient || {}) as Record<string, unknown>;
      const message = (body?.message || {}) as Record<string, unknown>;

      if (eventName.startsWith('user_')) await captureZaloOaId(String(recipient?.id || ''));

      if (eventName.startsWith('user_send')) {
        const uid = String(sender?.id || '');
        const msgId = String(message?.msg_id || '') || null;

        if (uid) {
          const fromName = await getZaloProfile(uid);

          // MÃ KÍCH HOẠT (6 số) -> gắn Zalo với tài khoản, trả lời xác nhận, không lưu / không báo sếp.
          if (eventName === 'user_send_text') {
            const linked = await consumeZaloLinkCode(String(message?.text || ''), uid, fromName);
            if (linked) {
              await sendZaloTo(
                uid,
                `✅ Đã kích hoạt Zalo cho tài khoản ${linked.name} (${linked.username}). Từ giờ phản hồi của khách hàng sẽ được báo về đây.`,
              );
              return { ok: true };
            }
          }
          if (await isLinkedZaloUser(uid)) return { ok: true };

          const saved = await recordInbound({
            waMessageId: msgId,
            fromPhone: uid,
            fromName,
            channel: 'ZALO',
            kind: 'message',
            type: eventName,
            text: summarizeZalo(eventName, message),
            raw: body,
          });
          if (saved) await notifyInboundReply(saved);
        }
      } else if (eventName === 'follow') {
        const uid = String((body?.follower as Record<string, unknown> | undefined)?.id || '');
        if (uid) {
          const fromName = await getZaloProfile(uid);
          await recordInbound({
            waMessageId: `zalo-follow-${uid}-${timestamp}`,
            fromPhone: uid,
            fromName,
            channel: 'ZALO',
            kind: 'message',
            type: 'follow',
            text: '[Đã quan tâm OA]',
            raw: body,
          });
        }
      }
    } catch (err) {
      this.logger.error(`[zaloWebhook] error: ${err instanceof Error ? err.stack : String(err)}`);
    }

    return { ok: true };
  }
}
