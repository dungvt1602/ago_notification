import { HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { webReq } from '@common/http/web-request';
import { parseId } from '@common/http/parse-id';
import { AuditService } from '@common/audit/audit.service';
import {
  createSupplierSchema,
  patchSupplierSchema,
  type CreateSupplierInput,
  type PatchSupplierInput,
} from '@core/validation/supplier.schema';
import { SuppliersRepository } from './suppliers.repository';

// "" / null / chỉ khoảng trắng -> null để cột tuỳ chọn không lưu chuỗi rỗng.
const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

function notFound(): HttpException {
  return new HttpException({ error: 'Không tìm thấy nhà cung cấp.' }, 404);
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly repo: SuppliersRepository,
    private readonly audit: AuditService,
  ) {}

  list(search?: string | null) {
    const kw = search?.trim();
    const where: Prisma.SupplierWhereInput = kw
      ? {
          OR: [
            { name: { contains: kw, mode: 'insensitive' } },
            { company: { contains: kw, mode: 'insensitive' } },
            { phone: { contains: kw, mode: 'insensitive' } },
            { email: { contains: kw, mode: 'insensitive' } },
          ],
        }
      : {};
    return this.repo.findMany(where);
  }

  async create(req: Request, body: unknown) {
    const input: CreateSupplierInput = createSupplierSchema.parse(body);
    const row = await this.repo.create({
      name: input.name,
      company: blank(input.company),
      phone: blank(input.phone),
      email: blank(input.email),
      zaloUserId: blank(input.zaloUserId),
      note: blank(input.note),
    });
    await this.audit.audit(webReq(req), { action: 'NCC_TAO', target: row.name });
    return row;
  }

  async update(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id nhà cung cấp');
    const input: PatchSupplierInput = patchSupplierSchema.parse(body);
    const before = await this.repo.findById(id);
    if (!before) throw notFound();
    const data: Prisma.SupplierUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.company !== undefined) data.company = blank(input.company);
    if (input.phone !== undefined) data.phone = blank(input.phone);
    if (input.email !== undefined) data.email = blank(input.email);
    if (input.zaloUserId !== undefined) data.zaloUserId = blank(input.zaloUserId);
    if (input.note !== undefined) data.note = blank(input.note);
    const row = await this.repo.update(id, data);
    await this.audit.audit(webReq(req), { action: 'NCC_SUA', target: row.name });
    return row;
  }

  async remove(req: Request, idRaw: string) {
    const id = parseId(idRaw, 'Id nhà cung cấp');
    const before = await this.repo.findById(id);
    if (!before) throw notFound();
    // NCC đã có lời mời RFQ thì giữ lại để không mất lịch sử báo giá (FK cũng RESTRICT).
    if ((await this.repo.countInvitations(id)) > 0) {
      throw new Error('Nhà cung cấp đã được gửi yêu cầu báo giá nên không thể xoá.');
    }
    await this.repo.remove(id);
    await this.audit.audit(webReq(req), { action: 'NCC_XOA', target: before.name });
    return { ok: true };
  }
}
