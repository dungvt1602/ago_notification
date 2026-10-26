import { buildRfqMessage, formatDeadlineVN, type RfqMessageInput } from './zalo-rfq-message';

const base: RfqMessageInput = {
  code: 'RFQ-2026-0001',
  title: 'Xoài cát Hoà Lộc',
  deadline: new Date('2026-11-10T10:30:00.000Z'), // 17:30 giờ VN
  note: null,
  itemCount: 3,
  link: 'http://app.test/ncc/TOKEN',
  imageUrl: 'http://app.test/api/supplier-rfqs/1/image',
};

type ListMsg = {
  attachment: {
    type: string;
    payload: { template_type: string; elements: Array<Record<string, unknown>> };
  };
};

describe('buildRfqMessage', () => {
  it('định dạng hạn theo giờ Việt Nam', () => {
    expect(formatDeadlineVN(base.deadline as Date)).toBe('17:30 10/11/2026');
  });

  it('list: 1 phần tử có ảnh + default_action mở link', () => {
    const m = buildRfqMessage('list', base) as ListMsg;
    expect(m.attachment.type).toBe('template');
    expect(m.attachment.payload.template_type).toBe('list');
    expect(m.attachment.payload.elements).toHaveLength(1);
    const el = m.attachment.payload.elements[0];
    expect(el.title).toBe('Xoài cát Hoà Lộc');
    expect(el.subtitle).toContain('RFQ-2026-0001');
    expect(el.subtitle).toContain('3 mặt hàng');
    expect(el.subtitle).toContain('17:30 10/11/2026');
    expect(el.image_url).toBe(base.imageUrl);
    expect(el.default_action).toEqual({ type: 'oa.open.url', url: base.link });
  });

  it('list: không có ảnh thì bỏ image_url; không hạn thì bỏ dòng hạn', () => {
    const m = buildRfqMessage('list', { ...base, imageUrl: null, deadline: null }) as ListMsg;
    const el = m.attachment.payload.elements[0];
    expect('image_url' in el).toBe(false);
    expect(String(el.subtitle)).not.toContain('Hạn');
  });

  it('list: cắt tiêu đề quá dài', () => {
    const m = buildRfqMessage('list', { ...base, title: 'x'.repeat(300) }) as ListMsg;
    expect(String(m.attachment.payload.elements[0].title).length).toBeLessThanOrEqual(100);
  });

  it('text: có mã, tiêu đề, hạn và link', () => {
    const m = buildRfqMessage('text', base) as { text: string };
    expect(m.text).toContain('RFQ-2026-0001');
    expect(m.text).toContain('Xoài cát Hoà Lộc');
    expect(m.text).toContain('Hạn báo giá: 17:30 10/11/2026');
    expect(m.text).toContain(base.link);
  });

  it('text: không hạn thì không in dòng hạn', () => {
    const m = buildRfqMessage('text', { ...base, deadline: null }) as { text: string };
    expect(m.text).not.toContain('Hạn');
  });
});
