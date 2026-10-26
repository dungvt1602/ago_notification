import type { Prisma } from '@prisma/client';

/*
 * Ma trận so sánh giá (thuần): hàng = mặt hàng RFQ, cột = lời mời THẬT (không tính is_test).
 * Mỗi lời mời chỉ lấy PHIÊN BẢN MỚI NHẤT. Giá thấp nhất = bestInvitationId (hoà giá -> cột đứng trước).
 */
export type CompareRfq = {
  id: bigint;
  code: string;
  title: string;
  currency: string;
  deadline: Date | null;
  status: string;
};
export type CompareItem = {
  id: bigint;
  no: number;
  product: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
};
export type CompareQuoteItem = {
  rfqItemId: bigint;
  unitPrice: Prisma.Decimal;
  moq: Prisma.Decimal | null;
  leadTimeDays: number | null;
  note: string | null;
};
export type CompareQuote = {
  version: number;
  currency: string;
  note: string | null;
  submittedAt: Date;
  items: CompareQuoteItem[];
};
export type CompareInvitation = {
  id: bigint;
  supplierId: bigint | null;
  supplierName: string;
  status: string;
  isTest: boolean;
  quotes: CompareQuote[]; // thứ tự bất kỳ — hàm tự chọn version lớn nhất
};

const str = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

export function buildCompare(rfq: CompareRfq, items: CompareItem[], invitations: CompareInvitation[]) {
  const cols = invitations
    .filter((i) => !i.isTest)
    .map((inv) => ({
      inv,
      quote: inv.quotes.reduce<CompareQuote | null>(
        (best, q) => (!best || q.version > best.version ? q : best),
        null,
      ),
    }));

  const suppliers = cols.map(({ inv, quote }) => ({
    invitationId: inv.id.toString(),
    supplierId: inv.supplierId === null ? null : inv.supplierId.toString(),
    name: inv.supplierName,
    status: inv.status,
    submittedAt: quote ? quote.submittedAt : null,
    version: quote ? quote.version : null,
    currency: quote ? quote.currency : null,
    note: quote ? quote.note : null,
  }));

  const rows = [...items]
    .sort((a, b) => a.no - b.no)
    .map((item) => {
      let bestId: string | null = null;
      let bestPrice: Prisma.Decimal | null = null;
      const prices = cols.map(({ inv, quote }) => {
        const line = quote?.items.find((x) => x.rfqItemId === item.id);
        if (!line) return null;
        // Hoà giá thì giữ cột đầu tiên: chỉ thay khi NHỎ HƠN hẳn.
        if (bestPrice === null || line.unitPrice.lt(bestPrice)) {
          bestPrice = line.unitPrice;
          bestId = inv.id.toString();
        }
        return {
          invitationId: inv.id.toString(),
          unitPrice: line.unitPrice.toString(),
          moq: str(line.moq),
          leadTimeDays: line.leadTimeDays,
          note: line.note,
        };
      });
      return {
        itemId: item.id.toString(),
        no: item.no,
        product: item.product,
        unit: item.unit,
        quantity: str(item.quantity),
        prices,
        bestInvitationId: bestId,
      };
    });

  return {
    rfq: {
      id: rfq.id.toString(),
      code: rfq.code,
      title: rfq.title,
      currency: rfq.currency,
      deadline: rfq.deadline,
      status: rfq.status,
    },
    suppliers,
    rows,
  };
}
