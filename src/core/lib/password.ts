import bcrypt from 'bcryptjs';

// Băm mật khẩu (bcrypt).
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Hash bcrypt hợp lệ bắt đầu bằng $2 ($2a/$2b/$2y).
export function isRealHash(hash: string | null | undefined): boolean {
  return !!hash && hash.startsWith('$2');
}

// So khớp mật khẩu; hash placeholder (chưa đặt) -> false.
export function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!isRealHash(hash)) return Promise.resolve(false);
  return bcrypt.compare(plain, hash as string);
}
