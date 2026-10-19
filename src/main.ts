import 'dotenv/config';
import 'reflect-metadata';
import type { RawBodyRequest } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: webhook WhatsApp/Zalo cần đúng byte gốc để ký/forward (req.rawBody).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

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
  // (JSON hỏng vẫn trả 200, tin vẫn được forward nguyên byte). Phải đứng TRƯỚC json parser (parser thấy body đã đọc sẽ bỏ qua).
  app.use(
    '/api/webhooks',
    raw({ type: () => true, limit: '10mb' }),
    (req: RawBodyRequest<Request>, _res: Response, next: NextFunction) => {
      if (Buffer.isBuffer(req.body)) req.rawBody = req.body;
      next();
    },
  );

  // Import khách hàng gửi hàng chục nghìn dòng JSON. Ảnh template gửi thô (image/*): để limit rộng, controller tự
  // trả đúng "Ảnh quá lớn (tối đa 5MB)." như bản Next thay vì 413 của parser.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('raw', { type: 'image/*', limit: '50mb' });

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
