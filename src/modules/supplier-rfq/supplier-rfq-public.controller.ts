/*
 * /api/public/supplier-rfq/:token — NCC mở từ Zalo, KHÔNG cần header x-actor. Logic + giới hạn tần suất ở
 * SupplierRfqPublicService.
 */
import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody } from '@common/http/json-body';
import { SupplierRfqPublicService } from './supplier-rfq-public.service';

@Controller('public/supplier-rfq')
export class SupplierRfqPublicController {
  constructor(private readonly service: SupplierRfqPublicService) {}

  @Get(':token')
  get(@Req() req: Request, @Param('token') token: string) {
    return handle(() => this.service.get(req, token), 500);
  }

  @Post(':token/quote')
  @HttpCode(200)
  submit(@Req() req: Request, @Param('token') token: string, @JsonBody() body: unknown) {
    return handle(() => this.service.submit(req, token, body));
  }
}
