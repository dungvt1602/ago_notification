/*
 * /api/suppliers: CRUD nhà cung cấp (nội bộ, header x-actor-*). Hợp đồng: docs/06_FE_CONTRACT.md (mục RFQ).
 */
import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody } from '@common/http/json-body';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  list(@Query('search') search?: string) {
    return handle(() => this.service.list(search), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @JsonBody() body: unknown) {
    return handle(() => this.service.create(req, body));
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @JsonBody() body: unknown) {
    return handle(() => this.service.update(req, id, body));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(() => this.service.remove(req, id));
  }
}
