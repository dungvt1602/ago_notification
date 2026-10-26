import { z } from 'zod';

/*
 * Schema cho RFQ (nội bộ) và nộp giá của NCC (công khai). Tiền/số lượng nhận cả số lẫn chuỗi nhưng quy về
 * CHUỖI thập phân đúng khuôn Decimal(18,4) (tối đa 14 chữ số nguyên + 4 lẻ) để không mất độ chính xác.
 */

const optText = (max: number) => z.string().trim().max(max).nullish();

// "12", "12.5", 12.5 -> "12.5"; rỗng/null -> null; sai khuôn -> lỗi đúng ô.
function decimalField(label: string) {
  return z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined) return null;
      const s = (typeof v === 'number' ? String(v) : v).trim();
      if (s === '') return null;
      if (!/^\d{1,14}(\.\d{1,4})?$/.test(s)) {
        ctx.addIssue({ code: 'custom', message: `${label} phải là số không âm (tối đa 14 chữ số, 4 số lẻ)` });
        return z.NEVER;
      }
      return s;
    });
}

const currencyField = z.string().trim().min(3, 'Tiền tệ 3-8 ký tự').max(8, 'Tiền tệ 3-8 ký tự');

const deadlineField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined; // không gửi = không đổi (PATCH)
    if (v === null || v.trim() === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Hạn báo giá không hợp lệ' });
      return z.NEVER;
    }
    return d;
  });

export const rfqItemSchema = z.object({
  product: z.string().trim().min(1, 'Vui lòng nhập tên mặt hàng').max(255, 'Tên mặt hàng quá dài'),
  spec: optText(500),
  unit: optText(50),
  quantity: decimalField('Số lượng'),
  note: optText(2000),
});
export type RfqItemInput = z.infer<typeof rfqItemSchema>;

export const rfqItemsSchema = z.object({
  items: z.array(rfqItemSchema).max(200, 'Tối đa 200 mặt hàng'),
});

export const createRfqSchema = z.object({
  title: z.string().trim().min(1, 'Vui lòng nhập tiêu đề').max(255, 'Tiêu đề quá dài'),
  note: optText(4000),
  currency: currencyField.optional(),
  deadline: deadlineField,
  items: z.array(rfqItemSchema).max(200, 'Tối đa 200 mặt hàng').optional(),
});
export type CreateRfqInput = z.infer<typeof createRfqSchema>;

export const patchRfqSchema = z.object({
  title: z.string().trim().min(1, 'Vui lòng nhập tiêu đề').max(255, 'Tiêu đề quá dài').optional(),
  note: optText(4000),
  currency: currencyField.optional(),
  // undefined = không đổi; null/"" = bỏ hạn.
  deadline: deadlineField,
});
export type PatchRfqInput = z.infer<typeof patchRfqSchema>;

const idField = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = String(v).trim();
    if (!/^\d{1,18}$/.test(s)) {
      ctx.addIssue({ code: 'custom', message: `${label} không hợp lệ` });
      return z.NEVER;
    }
    return s;
  });

export const sendRfqSchema = z.object({
  supplierIds: z.array(idField('Id nhà cung cấp')).min(1, 'Chọn ít nhất một nhà cung cấp').max(200),
  resend: z.boolean().optional(),
});

export const testSendSchema = z.object({
  zaloUserId: z.string().trim().min(1, 'Vui lòng chọn người nhận thử').max(50, 'Zalo user_id quá dài'),
});

// ---- NCC nộp giá (công khai) ----
const intField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = (typeof v === 'number' ? String(v) : v).trim();
    if (s === '') return null;
    if (!/^\d{1,4}$/.test(s) || Number(s) > 3650) {
      ctx.addIssue({ code: 'custom', message: 'Thời gian giao hàng phải là số nguyên 0-3650 ngày' });
      return z.NEVER;
    }
    return Number(s);
  });

const validUntilField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v.trim() === '') return null;
    const s = v.trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00.000Z') : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: 'custom', message: 'Hiệu lực đến phải dạng YYYY-MM-DD' });
      return z.NEVER;
    }
    return s;
  });

export const quoteLineSchema = z.object({
  rfqItemId: idField('Mặt hàng'),
  // Bỏ trống = không báo giá mặt hàng này (phải có ít nhất 1 mặt hàng có giá, kiểm ở superRefine bên dưới).
  unitPrice: decimalField('Đơn giá'),
  moq: decimalField('MOQ'),
  leadTimeDays: intField,
  note: optText(1000),
});

export const submitQuoteSchema = z
  .object({
    currency: currencyField.optional(),
    validUntil: validUntilField,
    note: optText(1000),
    items: z.array(quoteLineSchema).min(1, 'Vui lòng nhập giá').max(200),
  })
  .superRefine((v, ctx) => {
    if (!v.items.some((i) => i.unitPrice !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Vui lòng nhập đơn giá cho ít nhất một mặt hàng',
      });
    }
    v.items.forEach((i, idx) => {
      // Giá 0 vô nghĩa với báo giá (và sẽ luôn thắng so sánh) -> phải > 0; muốn bỏ qua thì để trống.
      if (i.unitPrice !== null && Number(i.unitPrice) <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', idx, 'unitPrice'],
          message: 'Đơn giá phải lớn hơn 0',
        });
      }
    });
    const seen = new Set<string>();
    v.items.forEach((i, idx) => {
      if (seen.has(i.rfqItemId)) {
        ctx.addIssue({ code: 'custom', path: ['items', idx, 'rfqItemId'], message: 'Mặt hàng bị lặp' });
      }
      seen.add(i.rfqItemId);
    });
  });
export type SubmitQuoteInput = z.infer<typeof submitQuoteSchema>;
