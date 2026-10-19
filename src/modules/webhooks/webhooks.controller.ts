import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhooksService } from './webhooks.service';

/*
 * Cổng từ Next: GET/POST /api/webhooks/whatsapp và GET/POST /api/webhooks/zalo.
 * POST đọc RAW body (req.rawBody) vì chuỗi gốc được ký / chuyển tiếp nguyên văn.
 * Luôn trả đúng như bản Next (200 {ok:true} kể cả chữ ký sai; 503 {ok:false} khi tracking cần gửi lại).
 */

function rawOf(req: RawBodyRequest<Request>): string {
  return req.rawBody ? req.rawBody.toString('utf8') : '';
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Get('whatsapp')
  whatsappVerify(@Query() q: Record<string, string | undefined>, @Res() res: Response): void {
    const r = this.service.whatsappVerify(q);
    res.status(r.status).type('text/plain').send(r.body);
  }

  @Post('whatsapp')
  @HttpCode(200)
  async whatsappEvent(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const r = await this.service.whatsappEvent(rawOf(req));
    res.status(r.status).json(r.body);
  }

  // Zalo không dùng hub.challenge; GET chỉ để kiểm tra endpoint sống.
  @Get('zalo')
  zaloPing(@Res() res: Response): void {
    res.status(200).type('text/plain').send('ok');
  }

  @Post('zalo')
  @HttpCode(200)
  zaloEvent(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const macHeader = req.headers['x-zevent-signature'];
    const mac = Array.isArray(macHeader) ? macHeader.join(', ') : (macHeader ?? null);
    return this.service.zaloEvent(rawOf(req), mac);
  }
}
