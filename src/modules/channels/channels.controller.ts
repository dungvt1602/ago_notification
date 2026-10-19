/* Cổng từ Next: /api/channels và /api/channels/[id] (kênh gửi; chỉ trả api_key_env, không trả key thật). */
import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody } from '@common/http/json-body';
import { webReq } from '@common/http/web-request';
import { ChannelsService } from './channels.service';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  @Get()
  list() {
    return handle(() => this.service.listChannels(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@JsonBody() body: unknown, @Req() req: Request) {
    return handle(() => this.service.create(body, webReq(req)));
  }

  @Patch(':id')
  update(@Param('id') id: string, @JsonBody() body: unknown, @Req() req: Request) {
    return handle(() => this.service.update(id, body, webReq(req)));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(() => this.service.remove(id, webReq(req)));
  }
}
