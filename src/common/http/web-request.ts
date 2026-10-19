import type { Request } from 'express';
import type { BaseUrlReq } from '@core/http/baseUrl';

/* Bọc request Express thành hình `{ headers.get }` mà các service (auditService, baseUrl) đang dùng. */
export function webReq(req: Request): BaseUrlReq {
  return {
    headers: {
      get: (name: string) => {
        const v = req.headers[name.toLowerCase()];
        return Array.isArray(v) ? v.join(', ') : (v ?? null);
      },
    },
    protocol: req.protocol,
    host: req.get('host') ?? '',
  };
}
