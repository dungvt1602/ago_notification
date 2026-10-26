/*
 * Dựng payload tin tư vấn Zalo (POST /v3.0/oa/message/cs) cho RFQ — MỘT chỗ duy nhất, thuần (không I/O).
 *
 * Gửi tới NCC gồm tối đa 2 tin, theo thứ tự:
 *  1) (nếu RFQ có ảnh) tin ẢNH riêng — buildRfqImageMessage. Định dạng media/image viết theo trí nhớ tài liệu
 *     Zalo, CHƯA xác minh; tin này chỉ "cố gắng", lỗi không được chặn tin báo giá.
 *  2) tin báo giá: 'buttons' = chữ + 1 nút "Nhập giá" mở link (định dạng ĐÃ CHẠY THẬT trên cùng OA ở hệ thống
 *     ago-checklist-backend: message.text + attachment.template.payload.buttons[oa.open.url]);
 *     'text' = chữ + link thô, dự phòng khi Zalo từ chối tin có nút vì lý do nghiệp vụ.
 * Nút "Nhắn thử" ở màn RFQ hiện nguyên phản hồi Zalo để chỉnh; sai khuôn thì sửa DUY NHẤT file này.
 */
export type RfqMessageMode = 'buttons' | 'text';

export type RfqMessageInput = {
  code: string;
  title: string;
  deadline: Date | null;
  note?: string | null;
  itemCount: number;
  link: string;
  imageUrl: string | null; // URL công khai của ảnh (null = RFQ chưa có ảnh)
};

export type ZaloCsMessage = Record<string, unknown>;

export const BUTTON_TITLE = 'Nhập giá'; // Zalo giới hạn tiêu đề nút ~20 ký tự
const NOTE_MAX = 300;

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
const pad = (n: number) => String(n).padStart(2, '0');

// Hạn báo giá hiển thị theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ máy chủ.
export function formatDeadlineVN(d: Date): string {
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const hm = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return `${hm} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

function bodyLines(input: RfqMessageInput): string[] {
  const lines = [`Yêu cầu báo giá ${input.code}`, input.title];
  if (input.deadline) lines.push(`Hạn báo giá: ${formatDeadlineVN(input.deadline)}`);
  const note = input.note?.trim();
  if (note) lines.push(cut(note, NOTE_MAX));
  lines.push(`Số mặt hàng: ${input.itemCount}`);
  return lines;
}

export function buildRfqMessage(mode: RfqMessageMode, input: RfqMessageInput): ZaloCsMessage {
  if (mode === 'text') {
    return { text: [...bodyLines(input), '', `Bấm vào link để nhập giá: ${input.link}`].join('\n') };
  }
  return {
    text: bodyLines(input).join('\n'),
    attachment: {
      type: 'template',
      payload: {
        buttons: [{ title: BUTTON_TITLE, type: 'oa.open.url', payload: { url: input.link } }],
      },
    },
  };
}

// Tin ảnh riêng (best-effort, chưa xác minh định dạng).
export function buildRfqImageMessage(imageUrl: string): ZaloCsMessage {
  return {
    attachment: {
      type: 'template',
      payload: { template_type: 'media', elements: [{ media_type: 'image', url: imageUrl }] },
    },
  };
}

/*
 * Rơi về chữ (copy ShouldFallbackToText của ago-checklist-backend): tin có nút bị Zalo từ chối bằng lỗi NGHIỆP VỤ
 * không thuộc nhóm người nhận / hạn mức / token thì thử lại ĐÚNG MỘT lần dạng chữ (nhiều khả năng link nút ngoài
 * domain đã xác thực của OA). Nhóm kia thì gửi chữ cũng hỏng y hệt nên trả lỗi luôn. Lỗi mạng (không có mã) không rơi.
 */
const NO_FALLBACK_CODES = new Set([-230, -320, -32, -124, -216, -232, -201, -213, -214]);
export function shouldFallbackToText(code: number | undefined): boolean {
  return typeof code === 'number' && code !== 0 && !NO_FALLBACK_CODES.has(code);
}
