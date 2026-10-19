import { z } from "zod";

const numOrStr = z.union([z.number(), z.string()]);
// Ngày từ <input type="date"> ("2026-08-20"). Chuỗi rỗng / null = xoá ngày.
const dateStr = z.string().nullish();

export const createQuotationSchema = z.object({
  code: z.string().nullish(), // bỏ trống -> server tự sinh BG-<năm>-<số thứ tự>
  title: z.string().nullish(),
  totalAmount: numOrStr.optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  market: z.string().nullish(),
  issuedDate: dateStr,
  validUntil: dateStr,
});
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;

// Sửa thông tin báo giá (mặt hàng sửa riêng qua /items). Field vắng mặt = giữ nguyên.
export const updateQuotationSchema = z.object({
  code: z.string().min(1, "Thiếu mã báo giá").optional(),
  title: z.string().nullish(),
  currency: z.string().optional(),
  status: z.string().optional(),
  market: z.string().nullish(),
  issuedDate: dateStr,
  validUntil: dateStr,
});
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;

export const itemSchema = z.object({
  no: z.number().optional(),
  product: z.string().default(""),
  packing: z.string().nullish(),
  unit: z.string().nullish(),
  quantity: numOrStr.optional(),
  price: numOrStr.optional(),
  note: z.string().nullish(),
});
export const setItemsSchema = z.object({ items: z.array(itemSchema).default([]) });
export type SetItemsInput = z.infer<typeof setItemsSchema>;
export type ItemInput = z.infer<typeof itemSchema>;
