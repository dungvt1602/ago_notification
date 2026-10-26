import { Injectable } from '@nestjs/common';

/*
 * Giới hạn tần suất TRONG BỘ NHỚ cho route công khai, cửa sổ trượt 60 giây, hai nấc:
 *  - theo (tiền tố hash token + IP): 30 lượt/phút — chặn spam một link;
 *  - theo IP: 120 lượt/phút trên MỌI token — chặn quét/đoán token hàng loạt (mỗi token lạ là một khoá mới
 *    nên nấc 1 một mình không cản được).
 * Chỉ đúng với 1 instance (đủ cho chống dò/spam đơn giản; nhiều instance thì đếm riêng = nới lỏng).
 * Bộ nhớ bị chặn trên: tối đa MAX_KEYS khoá, đầy thì đẩy khoá CŨ NHẤT ra; dọn khoá hết hạn tối đa 1 lần/5 giây.
 */
export const PUBLIC_RATE_LIMIT = 30;
export const PUBLIC_IP_RATE_LIMIT = 120;
export const PUBLIC_RATE_WINDOW_MS = 60_000;
export const MAX_KEYS = 5_000;
const SWEEP_EVERY_MS = 5_000;

@Injectable()
export class PublicRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  get size(): number {
    return this.hits.size;
  }

  // true = được phép (đã ghi nhận lượt này ở cả hai nấc); false = vượt giới hạn (không ghi nhận gì thêm).
  allow(tokenKey: string, ip: string, now = Date.now()): boolean {
    const from = now - PUBLIC_RATE_WINDOW_MS;
    this.sweepMaybe(now, from);
    const kIp = `ip:${ip}`;
    const kTok = `t:${tokenKey}|${ip}`;
    const ipHits = this.recent(kIp, from);
    const tokHits = this.recent(kTok, from);
    if (ipHits.length >= PUBLIC_IP_RATE_LIMIT || tokHits.length >= PUBLIC_RATE_LIMIT) return false;
    this.put(kIp, [...ipHits, now]);
    this.put(kTok, [...tokHits, now]);
    return true;
  }

  private recent(key: string, from: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => t > from);
  }

  // Xoá rồi đặt lại để khoá vừa dùng nằm CUỐI thứ tự chèn; khi đầy bỏ khoá đầu (cũ nhất).
  private put(key: string, v: number[]): void {
    this.hits.delete(key);
    this.hits.set(key, v);
    while (this.hits.size > MAX_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }

  private sweepMaybe(now: number, from: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) {
      if (v.every((t) => t <= from)) this.hits.delete(k);
    }
  }
}
