import { Prisma } from '@prisma/client';
import { buildCompare, type CompareInvitation, type CompareItem } from './rfq-compare';

const D = (v: string) => new Prisma.Decimal(v);
const rfq = {
  id: 1n,
  code: 'RFQ-2026-0001',
  title: 'T',
  currency: 'VND',
  deadline: null,
  status: 'SENT',
};
const items: CompareItem[] = [
  { id: 11n, no: 1, product: 'Xoài', unit: 'kg', quantity: D('100') },
  { id: 12n, no: 2, product: 'Ổi', unit: 'kg', quantity: null },
];
const line = (rfqItemId: bigint, price: string, extra: Partial<{ moq: string; days: number }> = {}) => ({
  rfqItemId,
  unitPrice: D(price),
  moq: extra.moq ? D(extra.moq) : null,
  leadTimeDays: extra.days ?? null,
  note: null,
});
const when = new Date('2026-10-28T00:00:00.000Z');
const quote = (version: number, lines: ReturnType<typeof line>[], note: string | null = null) => ({
  version,
  currency: 'VND',
  note,
  submittedAt: when,
  items: lines,
});
const inv = (
  id: bigint,
  name: string,
  quotes: CompareInvitation['quotes'],
  isTest = false,
): CompareInvitation => ({
  id,
  supplierId: isTest ? null : id * 10n,
  supplierName: name,
  status: quotes.length ? 'SUBMITTED' : 'SENT',
  isTest,
  quotes,
});

describe('buildCompare', () => {
  it('chọn giá thấp nhất, bỏ qua ô trống, dùng phiên bản mới nhất', () => {
    const r = buildCompare(rfq, items, [
      inv(1n, 'A', [quote(1, [line(11n, '10')], 'cũ'), quote(2, [line(11n, '30'), line(12n, '5')], 'mới')]),
      inv(2n, 'B', [quote(1, [line(11n, '20', { moq: '50', days: 7 })])]),
      inv(3n, 'C', []),
    ]);
    expect(r.suppliers.map((s) => [s.invitationId, s.version])).toEqual([
      ['1', 2],
      ['2', 1],
      ['3', null],
    ]);
    expect(r.suppliers[0].note).toBe('mới');
    const row1 = r.rows[0];
    expect(row1.prices[0]?.unitPrice).toBe('30'); // version 2 của A, không phải 10
    expect(row1.prices[1]).toEqual({
      invitationId: '2',
      unitPrice: '20',
      moq: '50',
      leadTimeDays: 7,
      note: null,
    });
    expect(row1.prices[2]).toBeNull();
    expect(row1.bestInvitationId).toBe('2');
    expect(row1.quantity).toBe('100');
    expect(r.rows[1].prices).toEqual([expect.objectContaining({ unitPrice: '5' }), null, null]);
    expect(r.rows[1].bestInvitationId).toBe('1');
    expect(r.rows[1].quantity).toBeNull();
  });

  it('hoà giá -> cột đứng trước thắng', () => {
    const r = buildCompare(rfq, items, [
      inv(1n, 'A', [quote(1, [line(11n, '10.5000')])]),
      inv(2n, 'B', [quote(1, [line(11n, '10.5')])]),
    ]);
    expect(r.rows[0].bestInvitationId).toBe('1');
  });

  it('không ai báo giá mặt hàng -> bestInvitationId null; giá 0 vẫn tính', () => {
    const r = buildCompare(rfq, items, [inv(1n, 'A', [quote(1, [line(11n, '0')])])]);
    expect(r.rows[0].bestInvitationId).toBe('1');
    expect(r.rows[1].bestInvitationId).toBeNull();
  });

  it('loại lời mời thử (is_test) khỏi cột và khỏi giá tốt nhất', () => {
    const r = buildCompare(rfq, items, [
      inv(1n, 'A', [quote(1, [line(11n, '50')])]),
      inv(9n, 'Nhắn thử', [quote(1, [line(11n, '1')])], true),
    ]);
    expect(r.suppliers).toHaveLength(1);
    expect(r.rows[0].prices).toHaveLength(1);
    expect(r.rows[0].bestInvitationId).toBe('1');
  });
});
