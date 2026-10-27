import {
  buildRfqMessage,
  formatDeadlineVN,
  shouldFallbackToText,
  type RfqMessageInput,
} from './zalo-rfq-message';

const base: RfqMessageInput = {
  code: 'RFQ-2026-0001',
  title: 'Xoài cát Hoà Lộc',
  deadline: new Date('2026-11-10T10:30:00.000Z'), // 17:30 giờ VN
  note: null,
  itemCount: 3,
  link: 'http://app.test/ncc/TOKEN',
};

describe('buildRfqMessage', () => {
  it('định dạng hạn theo giờ Việt Nam', () => {
    expect(formatDeadlineVN(base.deadline as Date)).toBe('17:30 10/11/2026');
  });

  it('buttons: JSON chính xác (chữ + 1 nút Nhập giá + dòng link dự phòng nhỏ)', () => {
    expect(buildRfqMessage('buttons', base)).toEqual({
      text: 'Yêu cầu báo giá RFQ-2026-0001\nXoài cát Hoà Lộc\nHạn báo giá: 17:30 10/11/2026\nSố mặt hàng: 3\n\nKhông thấy nút? Mở link: http://app.test/ncc/TOKEN',
      attachment: {
        type: 'template',
        payload: {
          buttons: [
            { title: 'Nhập giá', type: 'oa.open.url', payload: { url: 'http://app.test/ncc/TOKEN' } },
          ],
        },
      },
    });
  });

  it('buttons: có ghi chú thì chèn trước "Số mặt hàng" và cắt ~300 ký tự; không hạn thì bỏ dòng hạn', () => {
    const m = buildRfqMessage('buttons', { ...base, deadline: null, note: ' ' + 'n'.repeat(500) }) as {
      text: string;
    };
    const lines = m.text.split('\n');
    expect(lines).toHaveLength(6); // 4 dòng nội dung + dòng trống + dòng link dự phòng
    expect(lines[2].length).toBe(300);
    expect(lines[2].endsWith('…')).toBe(true);
    expect(lines[3]).toBe('Số mặt hàng: 3');
    expect(m.text).not.toContain('Hạn');
  });

  it('tiêu đề nút ≤ 20 ký tự', () => {
    const m = buildRfqMessage('buttons', base) as {
      attachment: { payload: { buttons: Array<{ title: string }> } };
    };
    expect(m.attachment.payload.buttons[0].title.length).toBeLessThanOrEqual(20);
  });

  it('text: cùng nội dung + dòng link thô', () => {
    expect(buildRfqMessage('text', base)).toEqual({
      text: 'Yêu cầu báo giá RFQ-2026-0001\nXoài cát Hoà Lộc\nHạn báo giá: 17:30 10/11/2026\nSố mặt hàng: 3\n\nBấm vào link để nhập giá: http://app.test/ncc/TOKEN',
    });
  });
});

describe('shouldFallbackToText', () => {
  it('không rơi về chữ với lỗi người nhận / hạn mức / token và lỗi không có mã', () => {
    for (const c of [-230, -320, -32, -124, -216, -232, -201, -213, -214]) {
      expect(shouldFallbackToText(c)).toBe(false);
    }
    expect(shouldFallbackToText(undefined)).toBe(false);
    expect(shouldFallbackToText(0)).toBe(false);
  });
  it('lỗi nghiệp vụ khác (vd. link nút bị từ chối) thì rơi về chữ', () => {
    for (const c of [-1, -100, -233, -999]) expect(shouldFallbackToText(c)).toBe(true);
  });
});
