/* Cổng từ Next: /api/users, /api/users/[id], /api/users/[id]/zalo, /api/users/[id]/zalo/link-code. */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list() {
    return handle(() => this.service.listUsers(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Body() body: unknown, @Req() req: Request) {
    return handle(() => this.service.create(body, webReq(req)));
  }

  @Post(':id/zalo/link-code')
  @HttpCode(200)
  zaloLinkCode(@Param('id') id: string, @Req() req: Request) {
    return handle(() => this.service.zaloLinkCode(id, webReq(req)));
  }

  @Get(':id/zalo')
  zaloStatus(@Param('id') id: string) {
    return handle(() => this.service.zaloStatus(id), 500);
  }

  @Delete(':id/zalo')
  zaloUnlink(@Param('id') id: string) {
    return handle(() => this.service.zaloUnlink(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return handle(() => this.service.update(id, body, webReq(req)));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(() => this.service.remove(id, webReq(req)));
  }
}
