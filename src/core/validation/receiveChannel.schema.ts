import { z } from "zod";

// Kênh NHẬN (webhook) — cùng cấu trúc kênh gửi. api_key_env chứa TÊN biến env (verify token).
export const createReceiveChannelSchema = z.object({
  name: z.string().min(1, "Thiếu tên kênh"),
  type: z.string().min(1, "Thiếu loại kênh"), // TELEGRAM | ZALO | WHATSAPP
  accountId: z.string().min(1, "Thiếu account id"), // phone_number_id / OA id / bot id NHẬN
  apiKeyEnv: z.string().min(1, "Thiếu tên biến env (verify token)"),
  note: z.string().nullish(),
  isActive: z.boolean().optional(),
});
export type CreateReceiveChannelInput = z.infer<typeof createReceiveChannelSchema>;

export const updateReceiveChannelSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  accountId: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  note: z.string().nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateReceiveChannelInput = z.infer<typeof updateReceiveChannelSchema>;
