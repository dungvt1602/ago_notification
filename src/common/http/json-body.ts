import { createParamDecorator, ExecutionContext, HttpException } from '@nestjs/common';
import type { Request } from 'express';

/*
 * Body JSON giống `await req.json()` của Next: đọc bất kể content-type (xem middleware ở main.ts).
 * - @JsonBody(): như `await req.json()` — body rỗng/hỏng => 400 { error: <thông điệp SyntaxError> }.
 * - @LenientJsonBody(): như `await req.json().catch(() => ({}))` — body rỗng/hỏng => {}.
 */
type JsonReq = Request & { jsonError?: Error };

export const JsonBody = createParamDecorator((_data: unknown, ctx: ExecutionContext): unknown => {
  const req = ctx.switchToHttp().getRequest<JsonReq>();
  if (req.jsonError) throw new HttpException({ error: req.jsonError.message }, 400);
  return req.body;
});

export const LenientJsonBody = createParamDecorator((_data: unknown, ctx: ExecutionContext): unknown => {
  const req = ctx.switchToHttp().getRequest<JsonReq>();
  return req.jsonError ? {} : req.body;
});

/* Middleware: biến chuỗi thô thành JSON; lỗi (rỗng/hỏng) ghi vào req.jsonError để decorator quyết định. */
export function parseJsonText(req: JsonReq, _res: unknown, next: (err?: unknown) => void): void {
  if (typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body) as unknown;
    } catch (e) {
      req.jsonError = e as Error;
      req.body = undefined;
    }
  } else if (!Buffer.isBuffer(req.body)) {
    req.jsonError = new SyntaxError('Unexpected end of JSON input');
    req.body = undefined;
  }
  next();
}
