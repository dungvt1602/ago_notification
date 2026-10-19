import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';
import type { CreateUserInput } from '@core/validation/user.schema';

@Injectable()
export class UsersRepository {
  findAll() {
    return prisma.user.findMany({
      // zaloBinding: cột "Zalo" ở màn Người dùng (đã kích hoạt nhận phản hồi khách về Zalo chưa)
      include: {
        userRoles: { include: { role: true } },
        zaloBinding: { select: { zaloUserId: true, zaloName: true, linkedAt: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findForLogin(id: string) {
    return prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { username: { equals: id, mode: 'insensitive' } },
          { email: { equals: id, mode: 'insensitive' } },
        ],
      },
      include: { userRoles: { include: { role: true } } },
    });
  }

  create(input: CreateUserInput, passwordHash: string) {
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

  update(id: bigint, data: Record<string, unknown>) {
    return prisma.user.update({ where: { id }, data });
  }

  // Gỡ vai trò + gán báo giá trước, rồi xóa — cùng một transaction.
  deleteWithRelations(uid: bigint) {
    return prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: uid } }),
      prisma.userQuotation.deleteMany({ where: { userId: uid } }),
      prisma.user.delete({ where: { id: uid } }),
    ]);
  }
}
