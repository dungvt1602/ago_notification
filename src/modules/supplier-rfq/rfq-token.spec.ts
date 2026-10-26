import { generateToken, hashToken, invitationExpiry, looksLikeToken } from './rfq-token';

describe('rfq-token', () => {
  it('sinh token base64url 43 ký tự (32 byte) và không trùng', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('hash SHA-256 hex 64 ký tự, ổn định và không chứa token gốc', () => {
    const t = generateToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(h);
    expect(h).not.toContain(t);
    expect(hashToken(t + 'x')).not.toBe(h);
  });

  it('looksLikeToken loại chuỗi sai độ dài / ký tự lạ', () => {
    expect(looksLikeToken('abc')).toBe(false);
    expect(looksLikeToken('!'.repeat(43))).toBe(false);
    expect(looksLikeToken('a'.repeat(44))).toBe(false);
  });

  it('hạn link = (hạn báo giá hoặc bây giờ) + 30 ngày', () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    expect(invitationExpiry(null, now).toISOString()).toBe('2026-11-26T00:00:00.000Z');
    const dl = new Date('2026-11-10T10:00:00.000Z');
    expect(invitationExpiry(dl, now).toISOString()).toBe('2026-12-10T10:00:00.000Z');
  });
});
