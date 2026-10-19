/*
 * Port từ Next: /api/send/{preview,confirm,cancel,process,batches,batches/[id]} và /api/send-jobs.
 */
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { SendService } from './send.service';

@Controller()
export class SendController {
  constructor(private readonly service: SendService) {}

  @Post('send/preview')
  @HttpCode(200)
  preview(@Req() req: Request, @Body() body: unknown) {
    return handle(() => this.service.preview(webReq(req), body));
  }

  @Post('send/confirm')
  @HttpCode(200)
  confirm(@Req() req: Request, @Body() body: unknown) {
    return handle(() => this.service.confirm(webReq(req), body));
  }

  @Post('send/cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Body() body: unknown) {
    return handle(() => this.service.cancel(webReq(req), body));
  }

  @Post('send/process')
  @HttpCode(200)
  process() {
    return handle(() => this.service.process(), 500);
  }

  @Get('send/batches')
  batches() {
    return handle(() => this.service.listBatches(), 500);
  }

  @Get('send/batches/:id')
  async batch(@Param('id') id: string) {
    const batch = await this.service.getBatch(id);
    if (!batch) throw new HttpException({ error: 'Không tìm thấy lệnh gửi.' }, 404);
    return batch;
  }

  @Get('send-jobs')
  jobs() {
    return handle(() => this.service.listJobs(), 500);
  }
}
