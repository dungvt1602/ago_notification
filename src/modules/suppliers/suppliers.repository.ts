/*
 * Tầng truy cập DB duy nhất của module suppliers (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

@Injectable()
export class SuppliersRepository {
  findMany(where: Prisma.SupplierWhereInput) {
    return prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  findById(id: bigint) {
    return prisma.supplier.findUnique({ where: { id } });
  }

  create(data: Prisma.SupplierCreateInput) {
    return prisma.supplier.create({ data });
  }

  update(id: bigint, data: Prisma.SupplierUpdateInput) {
    return prisma.supplier.update({ where: { id }, data });
  }

  remove(id: bigint) {
    return prisma.supplier.delete({ where: { id } });
  }

  countInvitations(supplierId: bigint) {
    return prisma.supplierRfqInvitation.count({ where: { supplierId } });
  }
}
