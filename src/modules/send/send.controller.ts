/*
 * Port từ Next: /api/send/{preview,confirm,cancel,process,batches,batches/[id]} và /api/send-jobs.
 */
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import {
  previewSend,
  confirmSend,
  cancelSend,
  processNextBatch,
  listBatches,
  getBatch,
} from '@core/services/sendService';
import { listSendJobs } from '@core/services/sendJobService';
import { previewSchema, confirmSchema, cancelSchema } from '@core/validation/send.schema';
import { actorFromRequest } from '@core/services/auditService';

@Controller()
export class SendController {
  @Post('send/preview')
  @HttpCode(200)
  preview(@Req() req: Request, @Body() body: unknown) {
    return handle(async () => {
      const input = previewSchema.parse(body);
      const a = actorFromRequest(webReq(req));
      return previewSend({ ...input, actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name } });
    });
  }

  @Post('send/confirm')
  @HttpCode(200)
  confirm(@Req() req: Request, @Body() body: unknown) {
    return handle(async () => {
      const input = confirmSchema.parse(body);
      const a = actorFromRequest(webReq(req));
      return confirmSend({ ...input, actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name } });
    });
  }

  @Post('send/cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Body() body: unknown) {
    return handle(async () => cancelSend({ ...cancelSchema.parse(body), actor: actorFromRequest(webReq(req)) }));
  }

  @Post('send/process')
  @HttpCode(200)
  process() {
    return handle(() => processNextBatch(), 500);
  }

  @Get('send/batches')
  batches() {
    return handle(() => listBatches(), 500);
  }

  @Get('send/batches/:id')
  async batch(@Param('id') id: string) {
    const batch = await getBatch(id);
    if (!batch) throw new HttpException({ error: 'Không tìm thấy lệnh gửi.' }, 404);
    return batch;
  }

  @Get('send-jobs')
  jobs() {
    return handle(() => listSendJobs(), 500);
  }
}
