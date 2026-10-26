import { HttpException } from '@nestjs/common';

/* Lỗi có status riêng (404/429...) theo hợp đồng `{ error }`; handle() cho HttpException đi thẳng ra ngoài. */
export const httpError = (status: number, error: string) => new HttpException({ error }, status);

export const MSG = {
  rfqNotFound: 'Không tìm thấy yêu cầu báo giá.',
  rfqClosed: 'Yêu cầu báo giá đã đóng.',
  linkInvalid: 'Link không hợp lệ hoặc đã hết hạn.',
  pastDeadline: 'Đã quá hạn báo giá.',
  tooFast: 'Thao tác quá nhanh, thử lại sau.',
  noZaloUserId: 'Nhà cung cấp chưa có Zalo user_id.',
  alreadySent: 'Đã gửi trước đó.',
  inFlight: 'Đang gửi cho nhà cung cấp này, vui lòng chờ.',
  inactive: 'Nhà cung cấp đã ngừng hoạt động.',
  tooManyTests: 'Đã nhắn thử quá nhiều lần, thử lại sau.',
  internal: 'Lỗi hệ thống khi gửi, thử lại sau.',
} as const;

/*
 * Gốc URL của link báo giá / URL ảnh gửi cho NCC: CHỈ đọc APP_BASE_URL (domain FE do chủ hệ thống khai).
 * Tuyệt đối không suy từ header request (Host/X-Forwarded-*) — kẻ gọi API giả header là biến link gửi NCC
 * thành link tới site lạ (host-header injection). Thiếu cấu hình thì từ chối gửi, không đoán.
 */
export function rfqBaseUrl(): string {
  const v = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!v) throw new Error('Chưa cấu hình APP_BASE_URL (domain FE) — không thể tạo link báo giá.');
  return v;
}
