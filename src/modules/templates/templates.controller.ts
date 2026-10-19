/*
 * Port từ Next: /api/templates, /sync-meta, /[id], /[id]/customers, /customers/link, /unlink,
 * /customers/[customerId], /[id]/image. Route tĩnh khai báo trước route tham số.
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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { handle } from '@common/http/handle';
import { webReq } from '@common/http/web-request';
import {
  listTemplates,
  listTemplatesPaged,
  listPoolTemplates,
  createStandaloneTemplate,
  getTemplateDetail,
  updateTemplate,
  deleteTemplate,
  listTemplateCustomers,
  linkCustomersToTemplate,
  unlinkCustomersFromTemplate,
  getTemplateImage,
  getTemplateImageMeta,
  setTemplateImage,
  clearTemplateImage,
} from '@core/services/templateService';
import {
  createCustomer,
  addCustomerToTemplate,
  removeCustomerFromTemplate,
} from '@core/services/customerService';
import { syncTemplatesFromMeta } from '@core/services/metaSyncService';
import { createTemplateSchema, updateTemplateSchema } from '@core/validation/template.schema';
import { createCustomerSchema } from '@core/validation/customer.schema';
import { publicImageUrl } from '@core/lib/storage';
import { audit, snapshot, labelOf, diffSummary } from '@core/services/auditService';

type Q = Record<string, string | undefined>;

@Controller('templates')
export class TemplatesController {
  @Get()
  list(@Query() q: Q) {
    if (q.pool) return handle(() => listPoolTemplates(), 500);
    // Có ?page hoặc ?search -> trả dạng phân trang; không có -> mảng toàn bộ.
    if (q.page !== undefined || q.search !== undefined) {
      return handle(
        () =>
          listTemplatesPaged({
            search: q.search ?? null,
            page: Number(q.page) || 1,
            limit: Number(q.limit) || 12,
            kind: q.kind ?? null,
          }),
        500,
      );
    }
    return handle(() => listTemplates(), 500);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: Request, @Body() body: unknown) {
    return handle(async () => {
      const input = createTemplateSchema.parse(body);
      const t = await createStandaloneTemplate(input);
      await audit(webReq(req), {
        action: 'TEMPLATE_TAO',
        target: labelOf('template', t as unknown as Record<string, unknown>),
        note: input.waTemplateName ? `template Meta: ${input.waTemplateName}` : null,
      });
      return t;
    });
  }

  @Post('sync-meta')
  @HttpCode(200)
  syncMeta(@Req() req: Request) {
    return handle(async () => {
      const r = await syncTemplatesFromMeta();
      await audit(webReq(req), {
        action: 'TEMPLATE_DONG_BO_META',
        target: 'WhatsApp Manager',
        note: `kiểm ${r.checked} template, cập nhật ${r.updated}, không thấy trên Meta ${r.notFound}`,
      });
      return r;
    }, 500);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const t = await getTemplateDetail(id);
    if (!t) throw new HttpException({ error: 'Không tìm thấy template' }, 404);
    return t;
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const input = updateTemplateSchema.parse(body);
      const before = await snapshot('template', id);
      const r = await updateTemplate(id, input);
      await audit(webReq(req), {
        action: 'TEMPLATE_SUA',
        target: labelOf('template', before, id),
        note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
      });
      return r;
    });
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return handle(async () => {
      const before = await snapshot('template', id);
      const r = await deleteTemplate(id);
      await audit(webReq(req), { action: 'TEMPLATE_XOA', target: labelOf('template', before, id) });
      return r;
    });
  }

  @Get(':id/customers')
  customers(@Param('id') id: string) {
    return handle(() => listTemplateCustomers(id), 500);
  }

  // Tạo khách gắn thẳng vào template này.
  @Post(':id/customers')
  @HttpCode(200)
  createCustomerFor(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const input = createCustomerSchema.parse(body);
      const c = await createCustomer({ ...input, templateId: id });
      const t = await snapshot('template', id);
      await audit(webReq(req), {
        action: 'KHACH_HANG_TAO',
        target: labelOf('customer', c as unknown as Record<string, unknown>),
        note: `gắn vào template ${labelOf('template', t, id)}; ${diffSummary(null, input as Record<string, unknown>)}`,
      });
      return c;
    });
  }

  // Gắn hàng loạt khách vào template (trùng bỏ qua). Body: { customerIds: string[] }.
  @Post(':id/customers/link')
  @HttpCode(200)
  link(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const b = body as { customerIds?: unknown } | null | undefined;
      const ids: string[] = Array.isArray(b?.customerIds) ? (b.customerIds as string[]) : [];
      const r = await linkCustomersToTemplate(id, ids);
      const t = await snapshot('template', id);
      await audit(webReq(req), {
        action: 'TEMPLATE_GAN_KHACH',
        target: labelOf('template', t, id),
        note: `${ids.length} khách`,
      });
      return r;
    });
  }

  // Gỡ hàng loạt khách khỏi template. Body: { customerIds: string[] }.
  @Post(':id/customers/unlink')
  @HttpCode(200)
  unlink(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const b = (body ?? {}) as { customerIds?: unknown };
      const ids: string[] = Array.isArray(b.customerIds) ? b.customerIds.map(String) : [];
      const r = await unlinkCustomersFromTemplate(id, ids);
      const t = await snapshot('template', id);
      await audit(webReq(req), {
        action: 'TEMPLATE_GO_KHACH',
        target: labelOf('template', t, id),
        note: `${r.unlinked} khách`,
      });
      return r;
    });
  }

  // Gắn 1 khách hiện có vào template (tạo link N-N).
  @Post(':id/customers/:customerId')
  @HttpCode(200)
  addCustomer(@Req() req: Request, @Param('id') id: string, @Param('customerId') customerId: string) {
    return handle(async () => {
      const r = await addCustomerToTemplate(id, customerId);
      const [t, c] = await Promise.all([snapshot('template', id), snapshot('customer', customerId)]);
      await audit(webReq(req), {
        action: 'TEMPLATE_GAN_KHACH',
        target: labelOf('template', t, id),
        note: labelOf('customer', c, customerId),
      });
      return r;
    });
  }

  // Gỡ 1 khách khỏi template (xoá link, khách vẫn còn ở template khác).
  @Delete(':id/customers/:customerId')
  removeCustomer(@Req() req: Request, @Param('id') id: string, @Param('customerId') customerId: string) {
    return handle(async () => {
      const [t, c] = await Promise.all([snapshot('template', id), snapshot('customer', customerId)]);
      const r = await removeCustomerFromTemplate(id, customerId);
      await audit(webReq(req), {
        action: 'TEMPLATE_GO_KHACH',
        target: labelOf('template', t, id),
        note: labelOf('customer', c, customerId),
      });
      return r;
    });
  }

  // Ảnh trên Storage -> redirect sang URL public; ảnh legacy trong DB -> trả bytes.
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const meta = await getTemplateImageMeta(id);
    if (!meta) {
      res.status(404).type('text/plain').send('Chưa có ảnh');
      return;
    }
    if (meta.storagePath) {
      res.redirect(302, publicImageUrl(meta.storagePath) + `?t=${meta.updatedAt.getTime()}`);
      return;
    }
    const img = await getTemplateImage(id);
    if (!img) {
      res.status(404).type('text/plain').send('Chưa có ảnh');
      return;
    }
    // Cache được vì UI gắn ?t=<updatedAt> làm cache-buster.
    res.setHeader('content-type', img.mime);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.status(200).send(Buffer.from(img.data));
  }

  // Lưu ảnh: body RAW là bytes ảnh, content-type là mime ảnh.
  @Post(':id/image')
  @HttpCode(200)
  setImage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return handle(async () => {
      const mime = req.headers['content-type'] || 'image/png';
      if (!mime.startsWith('image/')) throw new Error('File không phải ảnh.');
      const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      if (buf.byteLength === 0) throw new Error('Ảnh rỗng.');
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh quá lớn (tối đa 5MB).');
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const r = await setTemplateImage(id, ab, mime);
      const t = await snapshot('template', id);
      await audit(webReq(req), {
        action: 'TEMPLATE_DOI_ANH',
        target: labelOf('template', t, id),
        note: `${mime}, ${Math.round(ab.byteLength / 1024)} KB`,
      });
      return r;
    });
  }

  @Delete(':id/image')
  clearImage(@Req() req: Request, @Param('id') id: string) {
    return handle(async () => {
      const r = await clearTemplateImage(id);
      const t = await snapshot('template', id);
      await audit(webReq(req), { action: 'TEMPLATE_XOA_ANH', target: labelOf('template', t, id) });
      return r;
    });
  }
}
