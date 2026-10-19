import { LenientJsonBody } from '@common/http/json-body';
/* Cổng từ Next: POST /api/auth/login (đăng nhập, ghi nhật ký cả thành công lẫn thất bại). */
import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { webReq } from '@common/http/web-request';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@LenientJsonBody() raw: unknown, @Req() req: Request) {
    return this.service.login(raw, webReq(req));
  }
}
