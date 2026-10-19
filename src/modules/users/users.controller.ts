/* Cổng từ Next: /api/users, /api/users/[id], /api/users/[id]/zalo, /api/users/[id]/zalo/link-code. */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import { listUsers, createUser, updateUser, deleteUser } from '@core/services/userService';
import { createUserSchema, updateUserSchema } from '@core/validation/user.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';
import { createZaloLinkCode, getZaloLinkStatus, unlinkZalo } from '@core/services/zaloLinkService';

@Controller('users')
export class UsersController {
  @Get()
  list() {
    return handle(() => listUsers(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = createUserSchema.parse(body);
      const u = await createUser(input);
      // Tự đăng ký (chưa đăng nhập) thì actor trống -> ghi chính người vừa tạo.
      await audit(webReq(req), {
        action: 'NGUOI_DUNG_TAO',
        target: labelOf('user', u as unknown as Record<string, unknown>),
        note: `email ${input.email}${input.password ? '' : ' (chưa đặt mật khẩu)'}`,
      });
      return u;
    });
  }

  @Post(':id/zalo/link-code')
  @HttpCode(200)
  zaloLinkCode(@Param('id') id: string, @Req() req: Request) {
    return handle(async () => {
      const r = await createZaloLinkCode(id);
      await audit(webReq(req), {
        action: 'ZALO_LAY_MA',
        target: r.userName,
        note: 'mã hiệu lực 10 phút (không ghi mã)',
      });
      return r;
    });
  }

  @Get(':id/zalo')
  zaloStatus(@Param('id') id: string) {
    return handle(() => getZaloLinkStatus(id), 500);
  }

  @Delete(':id/zalo')
  zaloUnlink(@Param('id') id: string) {
    return handle(() => unlinkZalo(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = updateUserSchema.parse(body);
      const before = await snapshot('user', id);
      const r = await updateUser(id, input);
      await audit(webReq(req), {
        action: 'NGUOI_DUNG_SUA',
        target: labelOf('user', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(async () => {
      const before = await snapshot('user', id);
      const r = await deleteUser(id);
      await audit(webReq(req), { action: 'NGUOI_DUNG_XOA', target: labelOf('user', before, id) });
      return r;
    });
  }
}
