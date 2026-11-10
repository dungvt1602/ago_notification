import { buildCustomerWhere } from './customers.service';

describe('buildCustomerWhere — lọc waStatus', () => {
  it('NO_WHATSAPP: chỉ khách đã bị đánh dấu', () => {
    expect(buildCustomerWhere({ waStatus: 'NO_WHATSAPP' })).toEqual({ AND: [{ waStatus: 'NO_WHATSAPP' }] });
  });

  it('OK: khách chưa bị đánh dấu (null hoặc khác NO_WHATSAPP)', () => {
    expect(buildCustomerWhere({ waStatus: 'OK' })).toEqual({
      AND: [{ OR: [{ waStatus: null }, { NOT: { waStatus: 'NO_WHATSAPP' } }] }],
    });
  });

  it('không truyền hoặc giá trị lạ: không thêm điều kiện waStatus', () => {
    expect(JSON.stringify(buildCustomerWhere({}))).not.toContain('waStatus');
    expect(JSON.stringify(buildCustomerWhere({ waStatus: 'abc' }))).not.toContain('waStatus');
  });
});

describe('buildCustomerWhere — lọc market', () => {
  it('một giá trị: khớp không phân biệt hoa thường', () => {
    expect(buildCustomerWhere({ market: 'India' })).toEqual({
      AND: [{ market: { equals: 'India', mode: 'insensitive' } }],
    });
  });

  it('nhiều cách ghi của cùng một nước (IN|India|INDIA): khớp tất cả', () => {
    expect(buildCustomerWhere({ market: 'IN|India|INDIA' })).toEqual({
      AND: [
        {
          OR: [
            { market: { equals: 'IN', mode: 'insensitive' } },
            { market: { equals: 'India', mode: 'insensitive' } },
            { market: { equals: 'INDIA', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('chuỗi rỗng / chỉ dấu ngăn: không thêm điều kiện', () => {
    expect(buildCustomerWhere({ market: ' | ' })).toEqual({});
    expect(buildCustomerWhere({ market: '' })).toEqual({});
  });
});
