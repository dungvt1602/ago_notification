import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { AuditService } from '@common/audit/audit.service';
import { PublicRateLimiter } from './rate-limiter';
import { generateToken, hashToken } from './rfq-token';
import { SupplierRfqPublicService } from './supplier-rfq-public.service';
import type { SupplierRfqRepository } from './supplier-rfq.repository';

const token = generateToken();
const future = () => new Date(Date.now() + 86_400_000);

function makeInv(over: { rfq?: object; inv?: object } = {}) {
  return {
    id: 7n,
    rfqId: 1n,
    supplierId: 5n,
    tokenHash: hashToken(token),
    isTest: false,
    status: 'SENT',
    viewedAt: null,
    expiresAt: future(),
    supplier: { name: 'NCC A' },
    quotes: [],
    rfq: {
      id: 1n,
      code: 'RFQ-2026-0001',
      title: 'Xoài',
      note: null,
      currency: 'VND',
      status: 'SENT',
      deadline: future(),
      image: { rfqId: 1n },
      items: [
        {
          id: 11n,
          no: 1,
          product: 'Xoài',
          spec: null,
          unit: 'kg',
          quantity: new Prisma.Decimal('10'),
          note: null,
        },
        { id: 12n, no: 2, product: 'Ổi', spec: null, unit: 'kg', quantity: null, note: null },
      ],
      ...over.rfq,
    },
    ...over.inv,
  };
}

function setup(inv: ReturnType<typeof makeInv> | null = makeInv()) {
  const cap: { outbox?: unknown } = {};
  const repo = {
    findInvitationByHash: jest.fn().mockResolvedValue(inv),
    markViewed: jest.fn().mockResolvedValue(undefined),
    submitQuote: jest.fn(),
  };
  repo.submitQuote.mockImplementation(
    (a: { outbox: (i: { version: number; quoteId: bigint }) => unknown }) => {
      cap.outbox = a.outbox({ version: 2, quoteId: 50n });
      return Promise.resolve({ version: 2, quoteId: 50n });
    },
  );
  const audit = { audit: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupplierRfqPublicService(
    repo as unknown as SupplierRfqRepository,
    new PublicRateLimiter(),
    audit as unknown as AuditService,
  );
  const req = { ip: '1.2.3.4' } as unknown as Request;
  return { svc, repo, audit, req, cap };
}
describe('SupplierRfqPublicService.get', () => {
  it('trả dữ liệu đúng lời mời, đánh dấu đã xem, không lộ hash/NCC khác', async () => {
    const t = setup();
    const r = await t.svc.get(t.req, token);
    expect(t.repo.markViewed).toHaveBeenCalledWith(7n, expect.any(Date));
    expect(r).toMatchObject({
      supplierName: 'NCC A',
      isTest: false,
      expired: false,
      canSubmit: true,
      quote: null,
      rfq: { code: 'RFQ-2026-0001', hasImage: true, imageUrl: '/api/supplier-rfqs/1/image' },
    });
    expect(r.items.map((i) => i.id)).toEqual(['11', '12']);
    const json = JSON.stringify(r);
    expect(json).not.toContain(hashToken(token));
    expect(json).not.toContain('tokenHash');
  });

  it('token lạ / sai hình thức / hết hạn -> 404 cùng một câu', async () => {
    for (const [inv, tk] of [
      [null, generateToken()],
      [makeInv(), 'abc'],
      [makeInv({ inv: { expiresAt: new Date(Date.now() - 1000) } }), token],
    ] as const) {
      const t = setup(inv);
      await expect(t.svc.get(t.req, tk)).rejects.toMatchObject({
        status: 404,
        response: { error: 'Link không hợp lệ hoặc đã hết hạn.' },
      });
    }
  });

  it('quá hạn hoặc RFQ đóng -> expired, canSubmit=false', async () => {
    const past = setup(makeInv({ rfq: { deadline: new Date(Date.now() - 1000) } }));
    expect(await past.svc.get(past.req, token)).toMatchObject({ expired: true, canSubmit: false });
    const closed = setup(makeInv({ rfq: { status: 'CLOSED' } }));
    expect(await closed.svc.get(closed.req, token)).toMatchObject({ canSubmit: false });
  });

  it('lượt thứ 31 trong 1 phút -> 429', async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) await t.svc.get(t.req, token);
    await expect(t.svc.get(t.req, token)).rejects.toMatchObject({
      status: 429,
      response: { error: 'Thao tác quá nhanh, thử lại sau.' },
    });
  });
});

describe('SupplierRfqPublicService.submit', () => {
  const good = { items: [{ rfqItemId: '11', unitPrice: '12.5', moq: 10 }, { rfqItemId: '12' }] };

  it('lưu phiên bản mới + outbox supplier_quote.submitted + nhật ký NCC_NOP_GIA', async () => {
    const t = setup();
    const r = await t.svc.submit(t.req, token, { ...good, currency: 'vnd', validUntil: '2026-12-31' });
    expect(r).toEqual({ ok: true, version: 2 });
    const args = t.repo.submitQuote.mock.calls[0][0] as {
      lines: Array<{ rfqItemId: bigint; unitPrice: string }>;
      currency: string;
      validUntil: Date;
    };
    expect(args.lines).toHaveLength(1); // dòng không giá bị bỏ
    expect(args.lines[0]).toMatchObject({ rfqItemId: 11n, unitPrice: '12.5' });
    expect(args.currency).toBe('VND');
    expect(args.validUntil.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(t.cap.outbox).toMatchObject({
      eventType: 'supplier_quote.submitted',
      eventVersion: 'v1',
      aggregateType: 'SupplierRfq',
      aggregateId: '1',
      aggregateCode: 'RFQ-2026-0001',
      status: 'PENDING',
      payload: {
        rfqId: '1',
        rfqCode: 'RFQ-2026-0001',
        invitationId: '7',
        supplierId: '5',
        version: 2,
        currency: 'VND',
      },
    });
    expect(t.audit.audit).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'NCC_NOP_GIA' }));
  });

  it('lời mời thử không phát sự kiện outbox', async () => {
    const t = setup(makeInv({ inv: { isTest: true, supplierId: null, supplier: null } }));
    await t.svc.submit(t.req, token, good);
    expect(t.cap.outbox).toBeNull();
  });

  it('quá hạn -> 400 Đã quá hạn báo giá.; RFQ đóng -> 400; không lưu gì', async () => {
    const past = setup(makeInv({ rfq: { deadline: new Date(Date.now() - 1000) } }));
    await expect(past.svc.submit(past.req, token, good)).rejects.toThrow('Đã quá hạn báo giá.');
    const closed = setup(makeInv({ rfq: { status: 'CLOSED' } }));
    await expect(closed.svc.submit(closed.req, token, good)).rejects.toThrow('Yêu cầu báo giá đã đóng.');
    expect(past.repo.submitQuote).not.toHaveBeenCalled();
    expect(closed.repo.submitQuote).not.toHaveBeenCalled();
  });

  it('mặt hàng không thuộc RFQ, giá âm, không có giá nào -> lỗi, không lưu', async () => {
    const t = setup();
    await expect(t.svc.submit(t.req, token, { items: [{ rfqItemId: '999', unitPrice: 1 }] })).rejects.toThrow(
      'Mặt hàng không thuộc yêu cầu báo giá này.',
    );
    await expect(
      t.svc.submit(t.req, token, { items: [{ rfqItemId: '11', unitPrice: -1 }] }),
    ).rejects.toThrow();
    await expect(t.svc.submit(t.req, token, { items: [{ rfqItemId: '11' }] })).rejects.toThrow();
    expect(t.repo.submitQuote).not.toHaveBeenCalled();
  });

  it('đơn giá 0 bị từ chối; tiền tệ khác RFQ bị từ chối; bỏ trống tiền tệ -> dùng của RFQ', async () => {
    const t = setup();
    await expect(
      t.svc.submit(t.req, token, { items: [{ rfqItemId: '11', unitPrice: '0' }] }),
    ).rejects.toThrow();
    await expect(
      t.svc.submit(t.req, token, { currency: 'USD', items: [{ rfqItemId: '11', unitPrice: 1 }] }),
    ).rejects.toThrow('Tiền tệ phải là VND.');
    expect(t.repo.submitQuote).not.toHaveBeenCalled();
    await t.svc.submit(t.req, token, { items: [{ rfqItemId: '11', unitPrice: 1 }] });
    expect((t.repo.submitQuote.mock.calls[0][0] as { currency: string }).currency).toBe('VND');
  });

  it('GET lời mời đã SUBMITTED vẫn chỉ gọi markViewed (repo chỉ đổi SENT->VIEWED), không đổi dữ liệu trả về', async () => {
    const t = setup(makeInv({ inv: { status: 'SUBMITTED', viewedAt: new Date() } }));
    await t.svc.get(t.req, token);
    expect(t.repo.markViewed).not.toHaveBeenCalled();
  });
});
