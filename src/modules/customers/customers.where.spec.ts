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
