/*
 * Tầng truy cập DB duy nhất của module supplier-rfq (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '@core/db/prisma';

export const rfqDetailInclude = {
  items: { orderBy: { no: 'asc' } },
  invitations: { orderBy: { id: 'asc' }, include: { supplier: { select: { name: true } } } },
  image: { select: { rfqId: true } },
} satisfies Prisma.SupplierRfqInclude;
export type RfqDetailRow = Prisma.SupplierRfqGetPayload<{ include: typeof rfqDetailInclude }>;

export const publicInvitationInclude = {
  rfq: { include: { items: { orderBy: { no: 'asc' } }, image: { select: { rfqId: true } } } },
  supplier: { select: { name: true } },
  quotes: { orderBy: { version: 'desc' }, take: 1, include: { items: true } },
} satisfies Prisma.SupplierRfqInvitationInclude;
export type PublicInvitationRow = Prisma.SupplierRfqInvitationGetPayload<{
  include: typeof publicInvitationInclude;
}>;

export type NewRfqItem = {
  product: string;
  spec: string | null;
  unit: string | null;
  quantity: string | null;
  note: string | null;
};

export type NewQuoteLine = {
  rfqItemId: bigint;
  unitPrice: string;
  moq: string | null;
  leadTimeDays: number | null;
  note: string | null;
};

const toItemRows = (items: NewRfqItem[]) => items.map((it, i) => ({ ...it, no: i + 1 }));

@Injectable()
export class SupplierRfqRepository {
  // ---------- RFQ ----------

  findMany(where: Prisma.SupplierRfqWhereInput) {
    return prisma.supplierRfq.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { _count: { select: { items: true, invitations: { where: { isTest: false } } } } },
    });
  }

  // Số lời mời THẬT đã có giá cho từng RFQ (đếm theo submitted_at để gửi lại link không làm tụt số).
  async countSubmittedByRfq(rfqIds: bigint[]): Promise<Map<string, number>> {
    if (rfqIds.length === 0) return new Map();
    const rows = await prisma.supplierRfqInvitation.groupBy({
      by: ['rfqId'],
      where: { rfqId: { in: rfqIds }, isTest: false, submittedAt: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.rfqId.toString(), r._count._all]));
  }

  findDetail(id: bigint) {
    return prisma.supplierRfq.findUnique({ where: { id }, include: rfqDetailInclude });
  }

  findById(id: bigint) {
    return prisma.supplierRfq.findUnique({ where: { id } });
  }

  findWithItems(id: bigint) {
    return prisma.supplierRfq.findUnique({
      where: { id },
      include: { items: { orderBy: { no: 'asc' } }, image: { select: { rfqId: true } } },
    });
  }

  /*
   * Tạo RFQ + mặt hàng với mã RFQ-YYYY-NNNN. Hai người tạo cùng lúc có thể ra cùng số -> vi phạm unique(code).
   * Sau lỗi Postgres huỷ cả transaction nên thử lại bằng transaction MỚI (tối đa 5 lần), không dùng lại tx cũ.
   */
  async createWithCode(
    year: number,
    data: Omit<Prisma.SupplierRfqUncheckedCreateInput, 'code' | 'items'>,
    items: NewRfqItem[],
  ) {
    const prefix = `RFQ-${year}-`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const last = await tx.supplierRfq.findFirst({
            where: { code: { startsWith: prefix } },
            orderBy: { id: 'desc' },
            select: { code: true },
          });
          const seq = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
          const code = prefix + String(seq).padStart(4, '0');
          return tx.supplierRfq.create({
            data: { ...data, code, items: { create: toItemRows(items) } },
            include: rfqDetailInclude,
          });
        });
      } catch (err) {
        const dup = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!dup || attempt >= 4) throw err;
      }
    }
  }

  update(id: bigint, data: Prisma.SupplierRfqUpdateInput) {
    return prisma.supplierRfq.update({ where: { id }, data });
  }

  remove(id: bigint) {
    return prisma.supplierRfq.delete({ where: { id } });
  }

  // Thay toàn bộ mặt hàng (chỉ gọi khi DRAFT). Xoá + tạo cùng transaction để không còn trạng thái nửa vời.
  replaceItems(rfqId: bigint, items: NewRfqItem[]) {
    return prisma.$transaction([
      prisma.supplierRfqItem.deleteMany({ where: { rfqId } }),
      prisma.supplierRfqItem.createMany({ data: toItemRows(items).map((r) => ({ ...r, rfqId })) }),
    ]);
  }

  // DRAFT -> SENT chỉ khi còn DRAFT (không đè CLOSED nếu có người đóng giữa chừng).
  markSentIfDraft(id: bigint) {
    return prisma.supplierRfq.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SENT' } });
  }

  // ---------- Ảnh ----------

  upsertImage(rfqId: bigint, mime: string, data: Buffer) {
    const bytes = new Uint8Array(data);
    return prisma.supplierRfqImage.upsert({
      where: { rfqId },
      create: { rfqId, mime, data: bytes },
      update: { mime, data: bytes },
      select: { rfqId: true },
    });
  }

  clearImage(rfqId: bigint) {
    return prisma.supplierRfqImage.deleteMany({ where: { rfqId } });
  }

  findImage(rfqId: bigint) {
    return prisma.supplierRfqImage.findUnique({ where: { rfqId } });
  }

  // ---------- So sánh ----------

  findForCompare(id: bigint) {
    return prisma.supplierRfq.findUnique({
      where: { id },
      include: {
        items: { orderBy: { no: 'asc' } },
        invitations: {
          where: { isTest: false },
          orderBy: { id: 'asc' },
          include: {
            supplier: { select: { name: true } },
            quotes: { orderBy: { version: 'desc' }, take: 1, include: { items: true } },
          },
        },
      },
    });
  }

  // ---------- Lời mời ----------

  findSuppliersByIds(ids: bigint[]) {
    return prisma.supplier.findMany({ where: { id: { in: ids } } });
  }

  // Lưu user_id đã tra từ SĐT (chỉ khi NCC còn trống, không đè giá trị người dùng vừa nhập).
  setSupplierZaloUserId(id: bigint, zaloUserId: string) {
    return prisma.supplier.updateMany({ where: { id, zaloUserId: null }, data: { zaloUserId } });
  }

  findInvitation(rfqId: bigint, supplierId: bigint) {
    return prisma.supplierRfqInvitation.findFirst({ where: { rfqId, supplierId } });
  }

  createInvitation(data: Prisma.SupplierRfqInvitationUncheckedCreateInput) {
    return prisma.supplierRfqInvitation.create({ data });
  }

  // Số lời mời THỬ vừa tạo trong RFQ — để chặn lạm dụng nút Nhắn thử.
  countTestInvitationsSince(rfqId: bigint, since: Date) {
    return prisma.supplierRfqInvitation.count({ where: { rfqId, isTest: true, createdAt: { gte: since } } });
  }

  // Đổi hạn báo giá thì dời hạn link của các lời mời THẬT theo (hạn mới + 30 ngày).
  setRealInvitationsExpiry(rfqId: bigint, expiresAt: Date) {
    return prisma.supplierRfqInvitation.updateMany({ where: { rfqId, isTest: false }, data: { expiresAt } });
  }

  updateInvitation(id: bigint, data: Prisma.SupplierRfqInvitationUncheckedUpdateInput) {
    return prisma.supplierRfqInvitation.update({ where: { id }, data });
  }

  // ---------- Nhân viên đã liên kết Zalo (người nhận tin thử) ----------

  findActiveZaloStaff() {
    return prisma.zaloUserBinding.findMany({
      where: { status: 'ACTIVE', user: { isActive: true } },
      include: { user: { select: { id: true, fullName: true, username: true } } },
    });
  }

  // ---------- Công khai theo token ----------

  findInvitationByHash(tokenHash: string) {
    return prisma.supplierRfqInvitation.findUnique({
      where: { tokenHash },
      include: publicInvitationInclude,
    });
  }

  // SENT -> VIEWED và ghi viewed_at đúng 1 lần (updateMany có điều kiện nên mở link nhiều lần không ghi đè).
  async markViewed(id: bigint, now: Date): Promise<void> {
    await prisma.supplierRfqInvitation.updateMany({
      where: { id, status: 'SENT' },
      data: { status: 'VIEWED' },
    });
    await prisma.supplierRfqInvitation.updateMany({
      where: { id, viewedAt: null },
      data: { viewedAt: now },
    });
  }

  /*
   * Nộp giá = quote mới (version = max + 1) + dòng giá + đổi lời mời sang SUBMITTED + (nếu cần) ghi
   * outbox_events, TẤT CẢ một transaction: ERP không bao giờ thấy sự kiện của một báo giá chưa lưu và ngược lại.
   * Hai lần nộp đồng thời cùng ra một version -> unique(invitation_id, version) từ chối, thử lại tx mới.
   */
  async submitQuote(args: {
    invitationId: bigint;
    currency: string;
    validUntil: Date | null;
    note: string | null;
    lines: NewQuoteLine[];
    now: Date;
    outbox: (info: { version: number; quoteId: bigint }) => Prisma.OutboxEventCreateInput | null;
  }): Promise<{ version: number; quoteId: bigint }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const max = await tx.supplierQuote.aggregate({
            where: { invitationId: args.invitationId },
            _max: { version: true },
          });
          const version = (max._max.version ?? 0) + 1;
          const quote = await tx.supplierQuote.create({
            data: {
              invitationId: args.invitationId,
              version,
              currency: args.currency,
              validUntil: args.validUntil,
              note: args.note,
              submittedAt: args.now,
              items: {
                create: args.lines.map((l) => ({
                  rfqItemId: l.rfqItemId,
                  unitPrice: l.unitPrice,
                  moq: l.moq,
                  leadTimeDays: l.leadTimeDays,
                  note: l.note,
                })),
              },
            },
          });
          await tx.supplierRfqInvitation.update({
            where: { id: args.invitationId },
            data: { status: 'SUBMITTED', submittedAt: args.now },
          });
          const ev = args.outbox({ version, quoteId: quote.id });
          if (ev) await tx.outboxEvent.create({ data: ev });
          return { version, quoteId: quote.id };
        });
      } catch (err) {
        const dup = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!dup || attempt >= 4) throw err;
      }
    }
  }
}
