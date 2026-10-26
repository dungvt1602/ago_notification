import { z } from 'zod';

// Trường tuỳ chọn: "" hoặc null = xoá giá trị.
const optText = (max: number) => z.string().trim().max(max).nullish();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên nhà cung cấp').max(255, 'Tên quá dài'),
  company: optText(255),
  phone: optText(30),
  email: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(255)
        .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email không hợp lệ'),
    ])
    .nullish(),
  zaloUserId: z
    .union([
      z.literal(''),
      z.string().trim().max(50, 'Zalo user_id quá dài').regex(/^\d+$/, 'Zalo user_id chỉ gồm chữ số'),
    ])
    .nullish(),
  note: optText(2000),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

// PATCH: sửa một phần — chỉ trường có mặt mới đổi.
export const patchSupplierSchema = createSupplierSchema.partial();
export type PatchSupplierInput = z.infer<typeof patchSupplierSchema>;
