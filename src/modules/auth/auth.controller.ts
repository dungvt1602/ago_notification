/* Cổng từ Next: POST /api/auth/login (đăng nhập, ghi nhật ký cả thành công lẫn thất bại). */
import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { webReq } from '@common/http/web-request';
import { findUserForLogin } from '@core/services/userService';
import { verifyPassword, isRealHash } from '@core/lib/password';
import { audit } from '@core/services/auditService';

@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  async login(@Body() raw: unknown, @Req() req: Request) {
    const body = (raw ?? {}) as { identifier?: unknown; password?: unknown };
    const identifier = String(body?.identifier || '').trim();
    const password = String(body?.password || '');
    if (!identifier) throw new HttpException({ error: 'Vui lòng nhập tài khoản.' }, 400);
    if (!password) throw new HttpException({ error: 'Vui lòng nhập mật khẩu.' }, 400);

    const fail = async (reason: string, status = 401): Promise<never> => {
      await audit(webReq(req), {
        action: 'DANG_NHAP_LOI',
        target: identifier,
        note: reason,
        result: 'FAILED',
        actor: { id: null, name: identifier },
      });
      throw new HttpException({ error: reason }, status);
    };

    const u = await findUserForLogin(identifier);
    if (!u) return fail('Tài khoản không tồn tại hoặc đã bị khóa.');

    if (!isRealHash(u.passwordHash)) {
      return fail('Tài khoản chưa được đặt mật khẩu. Nhờ admin đặt trong màn Người dùng.');
    }
    const ok = await verifyPassword(password, u.passwordHash);
    if (!ok) return fail('Mật khẩu không đúng.');

    const isAdmin = u.userRoles.some((r) => r.role.code === 'ADMIN');
    const name = u.fullName || u.username;
    await audit(webReq(req), {
      action: 'DANG_NHAP',
      target: u.username,
      note: isAdmin ? 'quản trị viên' : 'nhân viên',
      actor: { id: String(u.id), name },
    });
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      isAdmin,
      roleLabel: isAdmin ? 'Quản trị viên' : 'Nhân viên kinh doanh',
    };
  }
}
