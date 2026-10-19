import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';

/*
 * Tương đương handle() của Next (src/server/http/json.ts): chạy handler, chuẩn hoá lỗi.
 * ZodError -> 400 { error: "Dữ liệu không hợp lệ", issues }; lỗi khác -> errorStatus { error: message }.
 * Giữ nguyên mặc định: mutation 400, route đọc/cron/webhook truyền 500.
 */
export async function handle<T>(fn: () => Promise<T> | T, errorStatus = 400): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpException) throw err;
    if (err instanceof ZodError) {
      throw new HttpException({ error: 'Dữ liệu không hợp lệ', issues: err.issues }, 400);
    }
    throw new HttpException({ error: err instanceof Error ? err.message : String(err) }, errorStatus);
  }
}
