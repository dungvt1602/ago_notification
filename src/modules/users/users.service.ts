import { Injectable } from '@nestjs/common';
import type { ReqLike } from '@core/http/reqLike';
import { hashPassword } from '@core/lib/password';
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@core/validation/user.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';
import { createZaloLinkCode, getZaloLinkStatus, unlinkZalo } from '@core/services/zaloLinkService';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  listUsers() {
    return this.repo.findAll();
  }

  // Đăng nhập đơn giản: tra theo username HOẶC email, phải đang hoạt động.
  findUserForLogin(identifier: string) {
    return this.repo.findForLogin(identifier.trim());
  }

  async createUser(input: CreateUserInput) {
    const passwordHash = input.password ? await hashPassword(input.password) : 'SET_BY_ADMIN';
    return this.repo.create(input, passwordHash);
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const data: Record<string, unknown> = {};
    if (input.username !== undefined) data.username = input.username;
    if (input.email !== undefined) data.email = input.email;
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.password) data.passwordHash = await hashPassword(input.password); // trống = giữ nguyên
    return this.repo.update(BigInt(id), data);
  }

  async deleteUser(id: string) {
    await this.repo.deleteWithRelations(BigInt(id));
    return { ok: true };
  }

  async create(body: unknown, req: ReqLike) {
    const input = createUserSchema.parse(body);
    const u = await this.createUser(input);
    // Tự đăng ký (chưa đăng nhập) thì actor trống -> ghi chính người vừa tạo.
    await audit(req, {
      action: 'NGUOI_DUNG_TAO',
      target: labelOf('user', u as unknown as Record<string, unknown>),
      note: `email ${input.email}${input.password ? '' : ' (chưa đặt mật khẩu)'}`,
    });
    return u;
  }

  async zaloLinkCode(id: string, req: ReqLike) {
    const r = await createZaloLinkCode(id);
    await audit(req, {
      action: 'ZALO_LAY_MA',
      target: r.userName,
      note: 'mã hiệu lực 10 phút (không ghi mã)',
    });
    return r;
  }

  zaloStatus(id: string) {
    return getZaloLinkStatus(id);
  }

  zaloUnlink(id: string) {
    return unlinkZalo(id);
  }

  async update(id: string, body: unknown, req: ReqLike) {
    const input = updateUserSchema.parse(body);
    const before = await snapshot('user', id);
    const r = await this.updateUser(id, input);
    await audit(req, {
      action: 'NGUOI_DUNG_SUA',
      target: labelOf('user', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(id: string, req: ReqLike) {
    const before = await snapshot('user', id);
    const r = await this.deleteUser(id);
    await audit(req, { action: 'NGUOI_DUNG_XOA', target: labelOf('user', before, id) });
    return r;
  }
}
