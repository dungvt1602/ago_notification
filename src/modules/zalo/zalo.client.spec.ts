import { zaloFriendlyError } from './zalo.client';

describe('zaloFriendlyError', () => {
  it('ánh xạ các mã hay gặp sang câu tiếng Việt', () => {
    expect(zaloFriendlyError(-230)).toBe(
      'Người nhận không tương tác với OA quá 7 ngày — nhờ họ nhắn OA một tin rồi gửi lại.',
    );
    expect(zaloFriendlyError(-320)).toBe(
      'App Zalo chưa nối Zalo Cloud Account nên không gửi được tin ngoài khung 48 giờ (tin tính phí).',
    );
    expect(zaloFriendlyError(-32)).toBe('OA chạm hạn mức gọi API, thử lại sau 1 phút.');
    expect(zaloFriendlyError(-232, "User hasn't interacted yet")).toContain('chưa Quan tâm / chưa nhắn OA');
    expect(zaloFriendlyError(-201, 'x')).toContain('(error -201)');
  });
  it('mã lạ: giữ thông báo gốc của Zalo kèm mã', () => {
    expect(zaloFriendlyError(-1, 'Invalid')).toBe('Invalid (error -1)');
    expect(zaloFriendlyError(undefined)).toBe('Zalo từ chối tin');
  });
});
