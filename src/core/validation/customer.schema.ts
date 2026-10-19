import { z } from "zod";

const numOrStr = z.union([z.number(), z.string()]);

// Chỉ chứa zod (không import server) -> dùng lại được ở FE để bắt lỗi form.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\d{6,15}$/; // toàn số, 6-15 chữ số (đã gồm mã vùng)

// Trường tuỳ chọn: cho phép rỗng "" hoặc null; nếu có thì phải đúng định dạng.
const emailField = z
  .union([z.literal(""), z.string().regex(EMAIL_RE, "Email không hợp lệ")])
  .nullish();
const phoneField = (label: string) =>
  z
    .union([z.literal(""), z.string().regex(PHONE_RE, `${label} chỉ gồm 6-15 chữ số`)])
    .nullish();
// Bắt buộc: không rỗng + đúng định dạng.
const requiredPhone = z
  .string()
  .min(1, "Vui lòng nhập số WhatsApp")
  .regex(PHONE_RE, "Số WhatsApp chỉ gồm 6-15 chữ số");

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên khách").max(255, "Tên quá dài"),
  company: z.string().max(255).nullish(),
  phone: phoneField("SĐT khác"),
  whatsappPhone: requiredPhone,
  email: emailField,
  market: z.string().max(80).nullish(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  receiveQuotation: z.boolean().optional(),
  note: z.string().max(2000).nullish(),
  templateId: numOrStr.nullish(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

// PATCH: chỉ sửa thông tin khách (gán/gỡ template dùng API link riêng).
export const patchCustomerSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên khách").max(255, "Tên quá dài"),
  company: z.string().max(255).nullish(),
  phone: phoneField("SĐT khác"),
  whatsappPhone: requiredPhone,
  email: emailField,
  market: z.string().max(80).nullish(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  receiveQuotation: z.boolean().optional(),
  note: z.string().max(2000).nullish(),
});
export type PatchCustomerInput = z.infer<typeof patchCustomerSchema>;
