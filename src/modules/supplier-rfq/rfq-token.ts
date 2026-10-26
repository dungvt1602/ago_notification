import crypto from 'crypto';

/*
 * Token của lời mời RFQ: 32 byte ngẫu nhiên (base64url) nằm trong link gửi NCC. DB CHỈ lưu SHA-256 hex nên
 * lộ DB cũng không dựng lại được link. Mọi tra cứu theo token đều băm trước rồi so khớp tokenHash.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Token hợp lệ về hình thức (43 ký tự base64url) — loại sớm rác trước khi chạm DB.
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITATION_TTL_DAYS = 30;

// Link hết hạn 30 ngày sau hạn báo giá (không có hạn thì tính từ lúc gửi) để NCC còn xem lại được sau hạn.
export function invitationExpiry(deadline: Date | null, now: Date): Date {
  return new Date((deadline ?? now).getTime() + INVITATION_TTL_DAYS * DAY_MS);
}
