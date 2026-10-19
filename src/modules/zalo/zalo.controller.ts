import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { handle } from '@common/http/handle';
import { LenientJsonBody } from '@common/http/json-body';
import { webReq } from '@common/http/web-request';
import { ZaloService } from './zalo.service';

/*
 * Cổng từ Next: /api/zalo/{status,check,disconnect,refresh,test,senders,shared-users}
 * và /api/zalo/oauth/{start,exchange,callback}.
 */
@Controller('zalo')
export class ZaloController {
  constructor(private readonly zalo: ZaloService) {}

  @Get('status')
  status(@Req() req: Request) {
    return handle(() => this.zalo.status(webReq(req)), 500);
  }

  @Post('check')
  @HttpCode(200)
  check(@Req() req: Request) {
    return handle(() => this.zalo.check(webReq(req)));
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@Req() req: Request) {
    return handle(() => this.zalo.disconnect(webReq(req)));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request) {
    return handle(() => this.zalo.refresh(webReq(req)));
  }

  @Post('test')
  @HttpCode(200)
  test(@Req() req: Request, @LenientJsonBody() rawBody: unknown) {
    return handle(() => this.zalo.test(webReq(req), rawBody));
  }

  @Post('oauth/start')
  @HttpCode(200)
  oauthStart(@Req() req: Request, @LenientJsonBody() rawBody: unknown) {
    return handle(() => this.zalo.oauthStart(webReq(req), rawBody));
  }

  @Post('oauth/exchange')
  @HttpCode(200)
  oauthExchange(@LenientJsonBody() rawBody: unknown) {
    return handle(() => this.zalo.oauthExchange(rawBody));
  }

  @Get('oauth/callback')
  async oauthCallback(
    @Req() req: Request,
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.zalo.oauthCallback(webReq(req), q);
    res.redirect(307, r.url);
  }

  @Get('senders')
  senders() {
    return handle(() => this.zalo.senders(), 500);
  }

  @Get('shared-users')
  sharedUsers() {
    return handle(() => this.zalo.listSharedUsers(), 500);
  }
}
