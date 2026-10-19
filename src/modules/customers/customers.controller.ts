/*
 * Cổng từ Next: /api/customers, /api/customers/[id], /bulk-delete, /import, /markets, /search.
 * Route tĩnh khai báo TRƯỚC `:id`.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  deleteCustomersBulk,
  importCustomers,
  listCustomerMarkets,
  listCustomersPaged,
  listCustomerIds,
} from '@core/services/customerService';
import { createCustomerSchema, patchCustomerSchema } from '@core/validation/customer.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';

type Q = Record<string, string | undefined>;
type ImportRows = Parameters<typeof importCustomers>[0];

@Controller('customers')
export class CustomersController {
  @Get()
  list(@Query() q: Q) {
    return handle(
      () =>
        listCustomers({
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
  create(@Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = createCustomerSchema.parse(body);
      const c = await createCustomer(input);
      await audit(webReq(req), {
        action: 'KHACH_HANG_TAO',
        target: labelOf('customer', c as unknown as Record<string, unknown>),
        note: diffSummary(null, input as Record<string, unknown>),
      });
      return c;
    });
  }

  // Danh sách quốc gia (market) khác nhau — cho dropdown lọc khách hàng.
  @Get('markets')
  markets() {
    return handle(() => listCustomerMarkets(), 500);
  }

  // Danh sách khách có phân trang; ?idsOnly=1 chỉ trả { ids, total, inTemplateIds }.
  @Get('search')
  search(@Query() q: Q) {
    if (q.idsOnly) {
      return handle(
        () =>
          listCustomerIds({
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
        listCustomersPaged({
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
  bulkDelete(@Body() raw: unknown, @Req() req: Request) {
    return handle(async () => {
      const body = (raw ?? {}) as { ids?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((s) => /^\d+$/.test(s)) : [];
      if (!ids.length) throw new Error('Chưa chọn khách nào.');
      const r = await deleteCustomersBulk(ids);
      await audit(webReq(req), {
        action: 'KHACH_HANG_XOA',
        target: `${r.deleted} khách hàng`,
        note: r.sample.length ? `vd: ${r.sample.join(', ')}${r.deleted > r.sample.length ? '…' : ''}` : null,
      });
      return r;
    });
  }

  // Nhận mảng khách đã map ở client -> tạo hàng loạt.
  @Post('import')
  @HttpCode(200)
  importFile(@Body() raw: unknown, @Req() req: Request) {
    return handle(async () => {
      const inner = (raw as { rows?: unknown } | null)?.rows;
      const rows = (Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : []) as ImportRows;
      const r = (await importCustomers(rows)) as Record<string, unknown>;
      const summary = Object.entries(r)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      await audit(webReq(req), {
        action: 'KHACH_HANG_NHAP_FILE',
        target: `${rows.length} dòng`,
        note: summary || null,
      });
      return r;
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return handle(async () => {
      const input = patchCustomerSchema.parse(body);
      const before = await snapshot('customer', id);
      const r = await updateCustomer(id, input);
      await audit(webReq(req), {
        action: 'KHACH_HANG_SUA',
        target: labelOf('customer', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return handle(async () => {
      const before = await snapshot('customer', id);
      const r = await deleteCustomer(id);
      await audit(webReq(req), {
        action: 'KHACH_HANG_XOA',
        target: labelOf('customer', before, id),
        note: before ? [before.phone, before.whatsappPhone, before.market].filter(Boolean).join(' · ') : null,
      });
      return r;
    });
  }
}
