/*
 * Port từ Next: /api/quotations, /api/quotations/[id], /api/quotations/[id]/items,
 * /api/quotations/[id]/templates.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import {
  listQuotations,
  createQuotation,
  getQuotationDetail,
  updateQuotation,
  deleteQuotation,
  listItems,
  setItems,
} from '@core/services/quotationService';
import { listTemplatesByQuotation, createTemplate } from '@core/services/templateService';
import {
  createQuotationSchema,
  updateQuotationSchema,
  setItemsSchema,
} from '@core/validation/quotation.schema';
import { createTemplateSchema } from '@core/validation/template.schema';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';

@Controller('quotations')
export class QuotationsController {
  @Get()
  list() {
    return handle(() => listQuotations(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @Body() body: unknown) {
    return handle(async () => {
      const input = createQuotationSchema.parse(body);
      const q = await createQuotation(input);
      await audit(webReq(req), {
        action: 'BAO_GIA_TAO',
        target: labelOf('quotation', q as unknown as Record<string, unknown>),
        note: diffSummary(null, input as Record<string, unknown>),
      });
      return q;
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const q = await getQuotationDetail(id);
    if (!q) throw new HttpException({ error: 'Không tìm thấy báo giá' }, 404);
    return q;
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const input = updateQuotationSchema.parse(body);
      const before = await snapshot('quotation', id);
      const r = await updateQuotation(id, input);
      await audit(webReq(req), {
        action: 'BAO_GIA_SUA',
        target: labelOf('quotation', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(async () => {
      const before = await snapshot('quotation', id);
      const r = await deleteQuotation(id);
      await audit(webReq(req), { action: 'BAO_GIA_XOA', target: labelOf('quotation', before, id) });
      return r;
    });
  }

  @Get(':id/items')
  items(@Param('id') id: string) {
    return handle(() => listItems(id), 500);
  }

  @Put(':id/items')
  putItems(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const items = setItemsSchema.parse(body).items;
      const before = await listItems(id).catch(() => []);
      const r = await setItems(id, items);
      const q = await snapshot('quotation', id);
      const names = items
        .slice(0, 5)
        .map((it) => it.product)
        .filter(Boolean)
        .join(', ');
      await audit(webReq(req), {
        action: 'BAO_GIA_SUA_MAT_HANG',
        target: labelOf('quotation', q, id),
        note: `${before.length} → ${items.length} mặt hàng${names ? ': ' + names + (items.length > 5 ? '…' : '') : ''}`,
      });
      return r;
    });
  }

  @Get(':id/templates')
  templates(@Param('id') id: string) {
    return handle(() => listTemplatesByQuotation(id), 500);
  }

  @Post(':id/templates')
  @HttpCode(200)
  createTpl(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const input = createTemplateSchema.parse(body);
      const t = await createTemplate(id, input);
      const q = await snapshot('quotation', id);
      await audit(webReq(req), {
        action: 'TEMPLATE_TAO',
        target: labelOf('template', t as unknown as Record<string, unknown>),
        note: `thuộc báo giá ${labelOf('quotation', q, id)}${input.waTemplateName ? '; template Meta: ' + input.waTemplateName : ''}`,
      });
      return t;
    });
  }
}
