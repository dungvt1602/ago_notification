import 'dotenv/config';
import 'reflect-metadata';
import type { RawBodyRequest } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw, text } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { parseJsonText } from '@common/http/json-body';
import { AppModule } from './app.module';

async function bootstrap() {
  // Tự đọc body (không dùng parser mặc định): Next đọc `req.json()`/`req.text()` bất kể content-type.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.set('trust proxy', 1);
  // BigInt -> string (giống json() của bản Next).
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  // Next đọc `searchParams.get(k)` = giá trị ĐẦU của tham số, luôn là chuỗi. Express mặc định trả mảng/object
  // khi lặp `?a=1&a=2` hoặc `a[x]=1` -> ép về đúng ngữ nghĩa cũ.
  app.set('query parser', (qs: string) => {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(qs)) if (!(k in out)) out[k] = v;
    return out;
  });
  // Next không gắn ETag cho route động -> tắt để không phát sinh 304 trên các GET JSON.
  app.set('etag', false);

  // Webhook: Next đọc `await req.text()` bất kể content-type và không bao giờ từ chối body -> nhận RAW mọi loại
  // (JSON hỏng vẫn trả 200, tin vẫn được forward nguyên byte, req.rawBody dùng để ký/forward).
  app.use(
    '/api/webhooks',
    raw({ type: () => true, limit: '10mb' }),
    (req: RawBodyRequest<Request>, _res: Response, next: NextFunction) => {
      if (Buffer.isBuffer(req.body)) req.rawBody = req.body;
      next();
    },
  );
  // Ảnh template gửi thô, mọi content-type (thiếu header -> controller mặc định image/png như Next). Limit rộng để
  // controller tự trả đúng "Ảnh quá lớn (tối đa 5MB)." thay vì 413 của parser.
  app.use(/^\/api\/templates\/[^/]+\/image$/, (req: Request, res: Response, next: NextFunction) =>
    req.method === 'POST' ? raw({ type: () => true, limit: '50mb' })(req, res, next) : next(),
  );
  // Các route còn lại: đọc chuỗi thô ở mọi content-type rồi parse JSON (lỗi -> req.jsonError, xem json-body.ts).
  // Import khách hàng gửi hàng chục nghìn dòng nên limit 50mb.
  app.use(text({ type: () => true, limit: '50mb' }), parseJsonText);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length) {
    app.enableCors({ origin: origins, allowedHeaders: ['content-type', 'x-actor-id', 'x-actor-name'] });
  }
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
