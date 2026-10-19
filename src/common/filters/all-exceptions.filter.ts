import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/*
 * Mọi lỗi trả JSON `{ error: string }` (frontend đọc `data.error`). HttpException giữ nguyên body
 * (handle() đã dựng sẵn `{error, issues?}`); lỗi lạ (body-parser, bug) -> status của lỗi hoặc 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(this.toErrorBody(body));
      return;
    }
    const e = exception as { status?: number; message?: string };
    const status = typeof e?.status === 'number' ? e.status : 500;
    if (status >= 500) this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json({ error: e?.message ?? String(exception) });
  }

  // Lỗi dựng sẵn của Nest (route không tồn tại, body JSON hỏng) có dạng { message, error, statusCode };
  // FE chỉ đọc `error` nên đưa thông điệp thật vào đó (Next trả { error: message }).
  private toErrorBody(body: string | object): object {
    if (typeof body === 'string') return { error: body };
    const b = body as { message?: string | string[]; statusCode?: number; issues?: unknown };
    if (typeof b.statusCode === 'number' && b.message !== undefined && b.issues === undefined) {
      return { error: Array.isArray(b.message) ? b.message.join(', ') : b.message };
    }
    return body;
  }
}
