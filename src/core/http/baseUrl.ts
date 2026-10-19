import type { ReqLike } from './reqLike';

export type BaseUrlReq = ReqLike & { protocol: string; host: string };

// URL gốc công khai của app (để dựng callback URL OAuth Zalo...).
// Ưu tiên APP_BASE_URL (khai tay khi chạy sau proxy lạ); không có thì suy từ header request
// (Render/Vercel đặt x-forwarded-proto=https + host thật).
export function publicBaseUrl(req: BaseUrlReq): string {
  const env = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : v);
  const proto = first(req.headers.get('x-forwarded-proto')) || req.protocol.replace(':', '') || 'http';
  const host = first(req.headers.get('x-forwarded-host')) || req.headers.get('host') || req.host;
  return `${proto}://${host}`;
}
