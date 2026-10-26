/*
 * Dựng payload tin tư vấn Zalo (POST /v3.0/oa/message/cs) cho RFQ — MỘT chỗ duy nhất, thuần (không I/O).
 * Hai chế độ:
 *  - 'list': 1 phần tử (tiêu đề + mô tả + ảnh nếu có) bấm vào mở link (default_action oa.open.url).
 *  - 'text': văn bản + link, dự phòng khi Zalo từ chối dạng list.
 *
 * CHƯA ĐỐI CHIẾU tài liệu chính thức: tên trường của template 'list' dưới đây viết theo trí nhớ. Không thêm
 * `buttons` vì chưa chắc template list nhận trường đó — chỉ dựa vào default_action. Nút "Nhắn thử" ở màn RFQ
 * tồn tại chính để kiểm chứng: nó trả nguyên phản hồi Zalo, sai khuôn thì sửa DUY NHẤT file này.
 */
export type RfqMessageMode = 'list' | 'text';

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

const TITLE_MAX = 100; // giới hạn do ta đặt thận trọng, chưa xác minh với Zalo
const SUBTITLE_MAX = 400;

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
const pad = (n: number) => String(n).padStart(2, '0');

// Hạn báo giá hiển thị theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ máy chủ.
export function formatDeadlineVN(d: Date): string {
  const t = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const hm = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return `${hm} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

function subtitleOf(input: RfqMessageInput): string {
  const parts = [`Mã ${input.code}`, `${input.itemCount} mặt hàng`];
  if (input.deadline) parts.push(`Hạn báo giá: ${formatDeadlineVN(input.deadline)}`);
  const head = parts.join(' · ');
  const note = input.note?.trim();
  return cut(note ? `${head}\n${note}` : head, SUBTITLE_MAX);
}

export function buildRfqMessage(mode: RfqMessageMode, input: RfqMessageInput): ZaloCsMessage {
  if (mode === 'text') {
    const lines = [`Yêu cầu báo giá ${input.code}`, input.title];
    if (input.deadline) lines.push(`Hạn báo giá: ${formatDeadlineVN(input.deadline)}`);
    lines.push('', `Bấm vào link để nhập giá: ${input.link}`);
    return { text: lines.join('\n') };
  }
  const element: Record<string, unknown> = {
    title: cut(input.title, TITLE_MAX),
    subtitle: subtitleOf(input),
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
    default_action: { type: 'oa.open.url', url: input.link },
  };
  return {
    attachment: { type: 'template', payload: { template_type: 'list', elements: [element] } },
  };
}
