/*
 * Port từ Next: /api/quotations, /api/quotations/[id], /api/quotations/[id]/items,
 * /api/quotations/[id]/templates.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { QuotationsService } from './quotations.service';

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get()
  list() {
    return handle(() => this.service.list(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @Body() body: unknown) {
    return handle(() => this.service.create(webReq(req), body));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const q = await this.service.detail(id);
    if (!q) throw new HttpException({ error: 'Không tìm thấy báo giá' }, 404);
    return q;
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(() => this.service.update(webReq(req), id, body));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.remove(webReq(req), id));
  }

  @Get(':id/items')
  items(@Param('id') id: string) {
    return handle(() => this.service.items(id), 500);
  }

  @Put(':id/items')
  putItems(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(() => this.service.putItems(webReq(req), id, body));
  }

  @Get(':id/templates')
  templates(@Param('id') id: string) {
    return handle(() => this.service.templates(id), 500);
  }

  @Post(':id/templates')
  @HttpCode(200)
  createTpl(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(() => this.service.createTemplate(webReq(req), id, body));
  }
}
