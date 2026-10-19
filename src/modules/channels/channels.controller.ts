/* Cổng từ Next: /api/channels và /api/channels/[id] (kênh gửi; chỉ trả api_key_env, không trả key thật). */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { listChannels, createChannel, updateChannel, deleteChannel } from '@core/services/channelService';
import { createChannelSchema, updateChannelSchema } from '@core/validation/channel.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';

@Controller('channels')
export class ChannelsController {
  @Get()
  list() {
    return handle(() => listChannels(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = createChannelSchema.parse(body);
      const c = await createChannel(input);
      await audit(webReq(req), {
        action: 'KENH_GUI_TAO',
        target: labelOf('channel', c as unknown as Record<string, unknown>),
        note: diffSummary(null, input as Record<string, unknown>),
      });
      return c;
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = updateChannelSchema.parse(body);
      const before = await snapshot('channel', id);
      const r = await updateChannel(id, input);
      await audit(webReq(req), {
        action: 'KENH_GUI_SUA',
        target: labelOf('channel', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(async () => {
      const before = await snapshot('channel', id);
      const r = await deleteChannel(id);
      await audit(webReq(req), { action: 'KENH_GUI_XOA', target: labelOf('channel', before, id) });
      return r;
    });
  }
}
