/*
 * Port từ Next: /api/templates, /sync-meta, /[id], /[id]/customers, /customers/link, /unlink,
 * /customers/[customerId], /[id]/image. Route tĩnh khai báo trước route tham số.
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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody, LenientJsonBody } from '@common/http/json-body';
import { webReq } from '@common/http/web-request';
import { TemplatesService, type TemplateListQuery } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  list(@Query() q: TemplateListQuery) {
    return handle(() => this.service.list(q), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @JsonBody() body: unknown) {
    return handle(() => this.service.create(webReq(req), body));
  }

  @Post('sync-meta')
  @HttpCode(200)
  syncMeta(@Req() req: Request) {
    return handle(() => this.service.syncMeta(webReq(req)), 500);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const t = await this.service.detail(id);
    if (!t) throw new HttpException({ error: 'Không tìm thấy template' }, 404);
    return t;
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.update(webReq(req), id, body));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.remove(webReq(req), id));
  }

  @Get(':id/customers')
  customers(@Param('id') id: string) {
    return handle(() => this.service.customers(id), 500);
  }

  @Post(':id/customers')
  @HttpCode(200)
  createCustomerFor(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.createCustomerFor(webReq(req), id, body));
  }

  @Post(':id/customers/link')
  @HttpCode(200)
  link(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.link(webReq(req), id, body));
  }

  @Post(':id/customers/unlink')
  @HttpCode(200)
  unlink(@Req() req: Request, @Param('id') id: string, @LenientJsonBody() body: unknown) {
    return handle(() => this.service.unlink(webReq(req), id, body));
  }

  @Post(':id/customers/:customerId')
  @HttpCode(200)
  addCustomer(@Req() req: Request, @Param('id') id: string, @Param('customerId') customerId: string) {
    return handle(() => this.service.addCustomer(webReq(req), id, customerId));
  }

  @Delete(':id/customers/:customerId')
  removeCustomer(@Req() req: Request, @Param('id') id: string, @Param('customerId') customerId: string) {
    return handle(() => this.service.removeCustomer(webReq(req), id, customerId));
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const r = await this.service.image(id);
    if (r.kind === 'notFound') {
      res.status(404).type('text/plain').send('Chưa có ảnh');
      return;
    }
    if (r.kind === 'redirect') {
      res.redirect(302, r.url);
      return;
    }
    // Cache được vì UI gắn ?t=<updatedAt> làm cache-buster.
    res.setHeader('content-type', r.mime);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.status(200).send(Buffer.from(r.data));
  }

  @Post(':id/image')
  @HttpCode(200)
  setImage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(() => this.service.setImage(webReq(req), id, req.headers['content-type'], body));
  }

  @Delete(':id/image')
  clearImage(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.clearImage(webReq(req), id));
  }
}
