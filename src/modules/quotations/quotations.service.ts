import { Injectable } from '@nestjs/common';
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
import type { ReqLike } from '@core/http/reqLike';

@Injectable()
export class QuotationsService {
  list() {
    return listQuotations();
  }

  async create(req: ReqLike, body: unknown) {
    const input = createQuotationSchema.parse(body);
    const q = await createQuotation(input);
    await audit(req, {
      action: 'BAO_GIA_TAO',
      target: labelOf('quotation', q as unknown as Record<string, unknown>),
      note: diffSummary(null, input as Record<string, unknown>),
    });
    return q;
  }

  // Trả null nếu không có — controller quyết định 404.
  detail(id: string) {
    return getQuotationDetail(id);
  }

  async update(req: ReqLike, id: string, body: unknown) {
    const input = updateQuotationSchema.parse(body);
    const before = await snapshot('quotation', id);
    const r = await updateQuotation(id, input);
    await audit(req, {
      action: 'BAO_GIA_SUA',
      target: labelOf('quotation', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(req: ReqLike, id: string) {
    const before = await snapshot('quotation', id);
    const r = await deleteQuotation(id);
    await audit(req, { action: 'BAO_GIA_XOA', target: labelOf('quotation', before, id) });
    return r;
  }

  items(id: string) {
    return listItems(id);
  }

  async putItems(req: ReqLike, id: string, body: unknown) {
    const items = setItemsSchema.parse(body).items;
    const before = await listItems(id).catch(() => []);
    const r = await setItems(id, items);
    const q = await snapshot('quotation', id);
    const names = items
      .slice(0, 5)
      .map((it) => it.product)
      .filter(Boolean)
      .join(', ');
    await audit(req, {
      action: 'BAO_GIA_SUA_MAT_HANG',
      target: labelOf('quotation', q, id),
      note: `${before.length} → ${items.length} mặt hàng${names ? ': ' + names + (items.length > 5 ? '…' : '') : ''}`,
    });
    return r;
  }

  templates(id: string) {
    return listTemplatesByQuotation(id);
  }

  async createTemplate(req: ReqLike, id: string, body: unknown) {
    const input = createTemplateSchema.parse(body);
    const t = await createTemplate(id, input);
    const q = await snapshot('quotation', id);
    await audit(req, {
      action: 'TEMPLATE_TAO',
      target: labelOf('template', t as unknown as Record<string, unknown>),
      note: `thuộc báo giá ${labelOf('quotation', q, id)}${input.waTemplateName ? '; template Meta: ' + input.waTemplateName : ''}`,
    });
    return t;
  }
}
