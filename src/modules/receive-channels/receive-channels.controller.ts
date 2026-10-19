/* Cổng từ Next: /api/receive-channels và /api/receive-channels/[id] (kênh nhận; chỉ trả api_key_env). */
import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody } from '@common/http/json-body';
import { webReq } from '@common/http/web-request';
import { ReceiveChannelsService } from './receive-channels.service';

@Controller('receive-channels')
export class ReceiveChannelsController {
  constructor(private readonly service: ReceiveChannelsService) {}

  @Get()
  list() {
    return handle(() => this.service.listReceiveChannels(), 500);
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
