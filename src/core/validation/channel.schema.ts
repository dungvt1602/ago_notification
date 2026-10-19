import { z } from "zod";

export const createChannelSchema = z.object({
  name: z.string().min(1, "Thiếu tên kênh"),
  type: z.string().min(1, "Thiếu loại kênh"), // TELEGRAM | ZALO | WHATSAPP
  accountId: z.string().min(1, "Thiếu account id"),
  apiKeyEnv: z.string().min(1, "Thiếu tên biến env chứa API key"),
  note: z.string().nullish(),
  isActive: z.boolean().optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  accountId: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  note: z.string().nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
