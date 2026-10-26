import { HttpException } from '@nestjs/common';

/*
 * Id BigInt từ URL/body là CHUỖI số. BigInt('abc') ném SyntaxError khó hiểu -> kiểm trước, trả 400 rõ nghĩa.
 */
export function parseId(raw: unknown, label = 'Id'): bigint {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,18}$/.test(s)) throw new HttpException({ error: `${label} không hợp lệ.` }, 400);
  return BigInt(s);
}
