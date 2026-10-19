/*
 * Cổng từ Next: /api/customers, /api/customers/[id], /bulk-delete, /import, /markets, /search.
 * Route tĩnh khai báo TRƯỚC `:id`.
 */
import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { JsonBody, LenientJsonBody } from '@common/http/json-body';
import { CustomersService } from './customers.service';

type Q = Record<string, string | undefined>;

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  list(@Query() q: Q) {
    return handle(
      () =>
        this.service.listCustomers({
          excludeTemplate: q.excludeTemplate ?? null,
          market: q.market ?? null,
          search: q.search ?? null,
          sort: q.sort ?? null,
          dir: q.dir ?? null,
        }),
      500,
    );
  }

  @Post()
  @HttpCode(200)
  create(@JsonBody() body: unknown, @Req() req: Request) {
    return handle(() => this.service.createWithAudit(body, req));
  }

  // Danh sách quốc gia (market) khác nhau — cho dropdown lọc khách hàng.
  @Get('markets')
  markets() {
    return handle(() => this.service.listCustomerMarkets(), 500);
  }

  // Danh sách khách có phân trang; ?idsOnly=1 chỉ trả { ids, total, inTemplateIds }.
  @Get('search')
  search(@Query() q: Q) {
    if (q.idsOnly) {
      return handle(
        () =>
          this.service.listCustomerIds({
            market: q.market ?? null,
            search: q.search ?? null,
            phoneType: q.phoneType ?? null,
            hasWhatsapp: q.hasWhatsapp === '1',
            templateId: q.templateId ?? null,
          }),
        500,
      );
    }
    return handle(
      () =>
        this.service.listCustomersPaged({
          market: q.market ?? null,
          search: q.search ?? null,
          phoneType: q.phoneType ?? null,
          hasWhatsapp: q.hasWhatsapp === '1',
          sort: q.sort ?? null,
          dir: q.dir ?? null,
          page: Number(q.page ?? null) || 1,
          limit: Number(q.limit ?? null) || 20,
        }),
      500,
    );
  }

  // Xoá hàng loạt khách. Body: { ids: string[] }.
  @Post('bulk-delete')
  @HttpCode(200)
  bulkDelete(@LenientJsonBody() raw: unknown, @Req() req: Request) {
    return handle(() => this.service.bulkDeleteWithAudit(raw, req));
  }

  // Nhận mảng khách đã map ở client -> tạo hàng loạt.
  @Post('import')
  @HttpCode(200)
  importFile(@JsonBody() raw: unknown, @Req() req: Request) {
    return handle(() => this.service.importWithAudit(raw, req));
  }

  @Patch(':id')
  update(@Param('id') id: string, @JsonBody() body: unknown, @Req() req: Request) {
    return handle(() => this.service.updateWithAudit(id, body, req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(() => this.service.removeWithAudit(id, req));
  }
}
