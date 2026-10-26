import { MAX_KEYS, PublicRateLimiter } from './rate-limiter';

describe('PublicRateLimiter', () => {
  it('cho 30 lượt/phút/token+IP, lượt 31 bị chặn', () => {
    const l = new PublicRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(l.allow('k', '1.1.1.1', t0 + i)).toBe(true);
    expect(l.allow('k', '1.1.1.1', t0 + 100)).toBe(false);
  });

  it('token khác hoặc IP khác đếm riêng ở nấc token', () => {
    const l = new PublicRateLimiter();
    for (let i = 0; i < 30; i++) l.allow('a', '1.1.1.1', 1000);
    expect(l.allow('a', '1.1.1.1', 1000)).toBe(false);
    expect(l.allow('b', '1.1.1.1', 1000)).toBe(true);
    expect(l.allow('a', '2.2.2.2', 1000)).toBe(true);
  });

  it('cửa sổ trượt: sau 60 giây được phép lại', () => {
    const l = new PublicRateLimiter();
    for (let i = 0; i < 30; i++) l.allow('k', 'ip', 1000);
    expect(l.allow('k', 'ip', 1000 + 59_000)).toBe(false);
    expect(l.allow('k', 'ip', 1000 + 60_001)).toBe(true);
  });

  it('quét nhiều token ngẫu nhiên từ một IP: lượt 121 trong phút bị chặn', () => {
    const l = new PublicRateLimiter();
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (l.allow(`rand${i}`, '9.9.9.9', 5000 + i)) allowed++;
    expect(allowed).toBe(120);
    expect(l.allow('khac', '8.8.8.8', 5300)).toBe(true); // IP khác không bị ảnh hưởng
  });

  it('Map không vượt MAX_KEYS dù bị flood từ nhiều IP/token', () => {
    const l = new PublicRateLimiter();
    for (let i = 0; i < MAX_KEYS + 3000; i++) {
      l.allow(`tk${i}`, `10.0.${i % 250}.${Math.floor(i / 250)}`, 1000 + i);
      expect(l.size).toBeLessThanOrEqual(MAX_KEYS);
    }
  });

  it('dọn khoá hết hạn (không quét mỗi request)', () => {
    const l = new PublicRateLimiter();
    for (let i = 0; i < 100; i++) l.allow(`t${i}`, `ip${i}`, 1000);
    expect(l.size).toBe(200);
    l.allow('moi', 'ipmoi', 1000 + 70_000);
    expect(l.size).toBe(2);
  });
});
