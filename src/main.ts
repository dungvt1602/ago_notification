import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: webhook WhatsApp/Zalo cần đúng byte gốc để ký/forward (req.rawBody).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.set('trust proxy', 1);
  // BigInt -> string (giống json() của bản Next).
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  // Import khách hàng gửi hàng chục nghìn dòng JSON; ảnh template gửi thô (image/*, tối đa 5MB, controller kiểm lại).
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('raw', { type: 'image/*', limit: '6mb' });

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
