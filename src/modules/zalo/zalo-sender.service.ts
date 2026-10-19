import { Injectable } from '@nestjs/common';
import { ZaloSenderRepository } from './zalo-sender.repository';

type Sender = {
  userId: string;
  name: string;
  lastText: string;
  lastType: string;
  lastAt: Date;
  count: number;
};

@Injectable()
export class ZaloSenderService {
  constructor(private readonly repo: ZaloSenderRepository) {}

  // Người đã nhắn / quan tâm OA gần đây (từ inbound_messages channel=ZALO): user_id + tên hiển thị.
  // Admin cần user_id của sếp để thêm kênh nhận ZALO; màn Zalo OA hiện danh sách này kèm nút "Thêm làm kênh nhận".
  async listZaloSenders(limit = 30) {
    const rows = await this.repo.listRecentInbound();
    const existing = await this.repo.listZaloChannels();
    const byId = new Map(existing.map((c) => [c.accountId, c]));

    // Gom theo user_id, giữ tin mới nhất.
    const seen = new Map<string, Sender>();
    for (const r of rows) {
      const cur = seen.get(r.fromPhone);
      if (cur) {
        cur.count++;
        if (!cur.name && r.fromName) cur.name = r.fromName;
        continue;
      }
      seen.set(r.fromPhone, {
        userId: r.fromPhone,
        name: r.fromName || '',
        lastText: r.text || '',
        lastType: r.type || '',
        lastAt: r.receivedAt,
        count: 1,
      });
    }
    return [...seen.values()].slice(0, limit).map((s) => {
      const ch = byId.get(s.userId);
      return { ...s, receiveChannel: ch ? { name: ch.name, isActive: ch.isActive } : null };
    });
  }
}
