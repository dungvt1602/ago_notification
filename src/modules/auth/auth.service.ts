import { HttpException, Injectable } from '@nestjs/common';
import type { ReqLike } from '@core/http/reqLike';
import { verifyPassword, isRealHash } from '@core/lib/password';
import { AuditService } from '@common/audit/audit.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly auditService: AuditService,
  ) {}

  async login(raw: unknown, req: ReqLike) {
    const body = (raw ?? {}) as { identifier?: unknown; password?: unknown };
    const identifier = String(body?.identifier || '').trim();
    const password = String(body?.password || '');
    if (!identifier) throw new HttpException({ error: 'Vui lòng nhập tài khoản.' }, 400);
    if (!password) throw new HttpException({ error: 'Vui lòng nhập mật khẩu.' }, 400);

    const fail = async (reason: string, status = 401): Promise<never> => {
      await this.auditService.audit(req, {
        action: 'DANG_NHAP_LOI',
        target: identifier,
        note: reason,
        result: 'FAILED',
        actor: { id: null, name: identifier },
      });
      throw new HttpException({ error: reason }, status);
    };

    const u = await this.users.findUserForLogin(identifier);
    if (!u) return fail('Tài khoản không tồn tại hoặc đã bị khóa.');

    if (!isRealHash(u.passwordHash)) {
      return fail('Tài khoản chưa được đặt mật khẩu. Nhờ admin đặt trong màn Người dùng.');
    }
    const ok = await verifyPassword(password, u.passwordHash);
    if (!ok) return fail('Mật khẩu không đúng.');

    const isAdmin = u.userRoles.some((r) => r.role.code === 'ADMIN');
    const name = u.fullName || u.username;
    await this.auditService.audit(req, {
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
