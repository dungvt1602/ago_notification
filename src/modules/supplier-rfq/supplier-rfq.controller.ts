/*
 * /api/supplier-rfqs (nội bộ, header x-actor-*) + ảnh RFQ công khai. Hợp đồng: docs/06_FE_CONTRACT.md (mục RFQ).
 * Route tĩnh (test-recipients) khai báo TRƯỚC `:id`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody } from '@common/http/json-body';
import { SupplierRfqService } from './supplier-rfq.service';
import { SupplierRfqSendService } from './supplier-rfq-send.service';

@Controller('supplier-rfqs')
export class SupplierRfqController {
  constructor(
    private readonly service: SupplierRfqService,
    private readonly sender: SupplierRfqSendService,
  ) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string) {
    return handle(() => this.service.list({ search, status }), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @JsonBody() body: unknown) {
    return handle(() => this.service.create(req, body));
  }

  @Get('test-recipients')
  testRecipients() {
    return handle(() => this.service.testRecipients(), 500);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return handle(() => this.service.detail(id), 500);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.update(req, id, body));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.remove(req, id));
  }

  @Put(':id/items')
  replaceItems(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.replaceItems(req, id, body));
  }

  // Ảnh RFQ công khai: Zalo (và trang NCC) tải được không cần đăng nhập. Id ngoài khoảng/không có ảnh -> 404 text.
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const img = await this.service.image(id);
    if (!img) {
      res.status(404).type('text/plain').send('Chưa có ảnh');
      return;
    }
    res.setHeader('content-type', img.mime);
    res.setHeader('cache-control', 'public, max-age=300');
    res.status(200).send(Buffer.from(img.data));
  }

  // Body thô image/* (middleware ở main.ts), tối đa 5MB.
  @Post(':id/image')
  @HttpCode(200)
  setImage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(() => this.service.setImage(req, id, body));
  }

  @Delete(':id/image')
  clearImage(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.clearImage(req, id));
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.sender.send(req, id, body));
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.close(req, id));
  }

  @Post(':id/test-send')
  @HttpCode(200)
  testSend(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.sender.testSend(req, id, body));
  }

  @Get(':id/compare')
  compare(@Param('id') id: string) {
    return handle(() => this.service.compare(id), 500);
  }
}
