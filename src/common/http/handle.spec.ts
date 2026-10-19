import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { handle } from './handle';

async function caught(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('expected rejection');
}

describe('handle()', () => {
  it('trả nguyên kết quả khi thành công', async () => {
    await expect(handle(() => Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('lỗi thường -> errorStatus mặc định 400 với { error }', async () => {
    const e = await caught(handle(() => Promise.reject(new Error('Chưa chọn khách nào.'))));
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toEqual({ error: 'Chưa chọn khách nào.' });
  });

  it('errorStatus truyền vào được giữ nguyên (route đọc dùng 500)', async () => {
    const e = await caught(handle(() => Promise.reject(new Error('x')), 500));
    expect(e.getStatus()).toBe(500);
  });

  it('ZodError -> 400 "Dữ liệu không hợp lệ" kèm issues, bất kể errorStatus', async () => {
    const e = await caught(handle(() => z.object({ a: z.string() }).parse({}), 500));
    expect(e.getStatus()).toBe(400);
    const body = e.getResponse() as { error: string; issues: unknown[] };
    expect(body.error).toBe('Dữ liệu không hợp lệ');
    expect(body.issues.length).toBeGreaterThan(0);
  });
});
