/* Cổng từ Next: /api/receive-channels và /api/receive-channels/[id] (kênh nhận; chỉ trả api_key_env). */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import {
  listReceiveChannels,
  createReceiveChannel,
  updateReceiveChannel,
  deleteReceiveChannel,
} from '@core/services/receiveChannelService';
import {
  createReceiveChannelSchema,
  updateReceiveChannelSchema,
} from '@core/validation/receiveChannel.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';

@Controller('receive-channels')
export class ReceiveChannelsController {
  @Get()
  list() {
    return handle(() => listReceiveChannels(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = createReceiveChannelSchema.parse(body);
      const c = await createReceiveChannel(input);
      await audit(webReq(req), {
        action: 'KENH_NHAN_TAO',
        target: labelOf('receiveChannel', c as unknown as Record<string, unknown>),
        note: `nhận: ${input.accountId}${input.note ? ' — ' + input.note : ''}`,
      });
      return c;
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = updateReceiveChannelSchema.parse(body);
      const before = await snapshot('receiveChannel', id);
      const r = await updateReceiveChannel(id, input);
      await audit(webReq(req), {
        action: 'KENH_NHAN_SUA',
        target: labelOf('receiveChannel', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(async () => {
      const before = await snapshot('receiveChannel', id);
      const r = await deleteReceiveChannel(id);
      await audit(webReq(req), {
        action: 'KENH_NHAN_XOA',
        target: labelOf('receiveChannel', before, id),
        note: before ? `nhận: ${before.accountId}` : null,
      });
      return r;
    });
  }
}
