import { prisma } from "@core/db/prisma";
import { hashPassword } from "@core/lib/password";
import type { CreateUserInput, UpdateUserInput } from "@core/validation/user.schema";

export function listUsers() {
  return prisma.user.findMany({
    // zaloBinding: cột "Zalo" ở màn Người dùng (đã kích hoạt nhận phản hồi khách về Zalo chưa)
    include: { userRoles: { include: { role: true } }, zaloBinding: { select: { zaloUserId: true, zaloName: true, linkedAt: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// Đăng nhập đơn giản: tra theo username HOẶC email, phải đang hoạt động.
export function findUserForLogin(identifier: string) {
  const id = identifier.trim();
  return prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { username: { equals: id, mode: "insensitive" } },
        { email: { equals: id, mode: "insensitive" } },
      ],
    },
    include: { userRoles: { include: { role: true } } },
  });
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = input.password ? await hashPassword(input.password) : "SET_BY_ADMIN";
  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash,
      fullName: input.fullName ?? null,
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
    },
  });
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const data: Record<string, unknown> = {};
  if (input.username !== undefined) data.username = input.username;
  if (input.email !== undefined) data.email = input.email;
  if (input.fullName !== undefined) data.fullName = input.fullName;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password) data.passwordHash = await hashPassword(input.password); // trống = giữ nguyên
  return prisma.user.update({ where: { id: BigInt(id) }, data });
}

// Xóa người dùng: gỡ vai trò + gán báo giá trước, rồi xóa.
export async function deleteUser(id: string) {
  const uid = BigInt(id);
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: uid } }),
    prisma.userQuotation.deleteMany({ where: { userId: uid } }),
    prisma.user.delete({ where: { id: uid } }),
  ]);
  return { ok: true };
}
