import { z } from "zod";

export const createUserSchema = z.object({
  username: z.string().min(1, "Thiếu username"),
  email: z.string().min(1, "Thiếu email"),
  fullName: z.string().nullish(),
  password: z.string().optional(), // mật khẩu THẬT (sẽ băm bcrypt); trống = chưa đặt
  isActive: z.boolean().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  fullName: z.string().nullish(),
  password: z.string().optional(), // có giá trị = đổi mật khẩu; trống = giữ nguyên
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
