import {
  testSendSchema,
  createRfqSchema,
  patchRfqSchema,
  sendRfqSchema,
  submitQuoteSchema,
} from './supplierRfq.schema';

const ok = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, ...extra });
const parse = (v: unknown) => submitQuoteSchema.safeParse(v);
const msgs = (v: unknown) => {
  const r = parse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('submitQuoteSchema', () => {
  it('hợp lệ: chuẩn hoá số, bỏ dòng không giá khỏi kiểm tra', () => {
    const r = parse(
      ok(
        [
          { rfqItemId: 5, unitPrice: 12.5, moq: '100', leadTimeDays: 7, note: ' ghi chú ' },
          { rfqItemId: '6', unitPrice: '' },
        ],
        { currency: 'usd', validUntil: '2026-12-31', note: 'ok' },
      ),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items[0]).toMatchObject({ rfqItemId: '5', unitPrice: '12.5', moq: '100', leadTimeDays: 7 });
    expect(r.data.items[1].unitPrice).toBeNull();
    expect(r.data.validUntil).toBe('2026-12-31');
  });

  it('từ chối giá âm / quá 4 số lẻ / quá 14 chữ số nguyên / không phải số', () => {
    for (const bad of [-1, '-5', '1.23456', '123456789012345', 'abc', 1e21]) {
      expect(msgs(ok([{ rfqItemId: 1, unitPrice: bad }])).join()).toContain('Đơn giá');
    }
    expect(parse(ok([{ rfqItemId: 1, unitPrice: '99999999999999.9999' }])).success).toBe(true);
  });

  it('thiếu giá ở mọi mặt hàng hoặc mảng rỗng -> lỗi', () => {
    expect(msgs(ok([{ rfqItemId: 1 }, { rfqItemId: 2, unitPrice: null }]))).toContain(
      'Vui lòng nhập đơn giá cho ít nhất một mặt hàng',
    );
    expect(parse(ok([])).success).toBe(false);
  });

  it('MOQ âm, thời gian giao ngoài 0..3650 hoặc không nguyên -> lỗi', () => {
    expect(msgs(ok([{ rfqItemId: 1, unitPrice: 1, moq: -3 }])).join()).toContain('MOQ');
    for (const d of [-1, 3651, '1.5', 'x']) {
      expect(msgs(ok([{ rfqItemId: 1, unitPrice: 1, leadTimeDays: d }])).join()).toContain(
        'Thời gian giao hàng',
      );
    }
    expect(parse(ok([{ rfqItemId: 1, unitPrice: 1, leadTimeDays: 0 }])).success).toBe(true);
    expect(parse(ok([{ rfqItemId: 1, unitPrice: 1, leadTimeDays: 3650 }])).success).toBe(true);
  });

  it('ghi chú > 1000 ký tự, tiền tệ sai độ dài, validUntil sai -> lỗi', () => {
    const line = { rfqItemId: 1, unitPrice: 1 };
    expect(parse(ok([{ ...line, note: 'x'.repeat(1001) }])).success).toBe(false);
    expect(parse(ok([line], { note: 'x'.repeat(1001) })).success).toBe(false);
    expect(parse(ok([line], { currency: 'VN' })).success).toBe(false);
    expect(parse(ok([line], { currency: 'ABCDEFGHI' })).success).toBe(false);
    for (const v of ['2026-13-01', '2026-02-30', '31/12/2026', '2026-1-1']) {
      expect(msgs(ok([line], { validUntil: v })).join()).toContain('YYYY-MM-DD');
    }
  });

  it('mặt hàng lặp -> lỗi', () => {
    expect(
      msgs(
        ok([
          { rfqItemId: 1, unitPrice: 1 },
          { rfqItemId: '1', unitPrice: 2 },
        ]),
      ),
    ).toContain('Mặt hàng bị lặp');
  });
});

describe('createRfqSchema / patchRfqSchema / sendRfqSchema', () => {
  it('tạo RFQ: tiêu đề bắt buộc, hạn ISO hợp lệ, số lượng thập phân', () => {
    expect(createRfqSchema.safeParse({ title: '  ' }).success).toBe(false);
    const r = createRfqSchema.parse({
      title: 'Xoài',
      deadline: '2026-11-10T10:00:00.000Z',
      items: [{ product: 'Xoài', quantity: 12.5, unit: 'kg' }],
    });
    expect(r.deadline?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect(r.items?.[0].quantity).toBe('12.5');
    expect(createRfqSchema.safeParse({ title: 'x', deadline: 'không phải ngày' }).success).toBe(false);
    expect(createRfqSchema.safeParse({ title: 'x', items: [{ product: '' }] }).success).toBe(false);
  });

  it('PATCH: không gửi deadline = undefined (không đổi), null = bỏ hạn', () => {
    expect(patchRfqSchema.parse({ title: 'a' }).deadline).toBeUndefined();
    expect(patchRfqSchema.parse({ deadline: null }).deadline).toBeNull();
  });

  it('send: cần ít nhất một supplierId số', () => {
    expect(sendRfqSchema.safeParse({ supplierIds: [] }).success).toBe(false);
    expect(sendRfqSchema.safeParse({ supplierIds: ['abc'] }).success).toBe(false);
    expect(sendRfqSchema.parse({ supplierIds: [1, '2'], resend: true }).supplierIds).toEqual(['1', '2']);
  });
});

describe('testSendSchema', () => {
  it('nhận user_id hoặc SĐT, bỏ dấu phân cách', () => {
    for (const [inp, out] of [
      ['333333333333333333', '333333333333333333'],
      ['0900 000.009', '0900000009'],
      ['+84-900-000-009', '+84900000009'],
      ['84900000009', '84900000009'],
    ]) {
      expect(testSendSchema.parse({ zaloUserId: inp }).zaloUserId).toBe(out);
    }
  });
  it('từ chối chữ, rỗng, quá ngắn, quá dài', () => {
    for (const bad of ['', 'abc', '09ab', '+', '--', '1'.repeat(51), '++84900000009']) {
      expect(testSendSchema.safeParse({ zaloUserId: bad }).success).toBe(false);
    }
  });
});
