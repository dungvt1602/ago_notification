import crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { ZaloLinkRepository } from './zalo-link.repository';
import { ZaloTokenService } from './zalo-token.service';

// KÍCH HOẠT ZALO cho người dùng — mirror luồng của worker Go (zalo_link_requests / zalo_user_bindings):
//   1) Người dùng bấm "Kích hoạt Zalo" -> app cấp mã 6 số, sống 10 phút (createZaloLinkCode)
//   2) Người dùng mở Zalo cá nhân, nhắn đúng mã đó cho OA
//   3) Webhook Zalo nhận user_send_text -> consumeZaloLinkCode: khớp mã -> gắn zalo user_id với tài khoản
//      + TỰ TẠO kênh nhận ZALO (receive_channels) -> notifyInboundReply đã có sẵn sẽ báo phản hồi khách về Zalo đó.
//   4) Mã dùng 1 lần, xoá ngay khi khớp.

const CODE_TTL_MS = 10 * 60 * 1000;

function sixDigits(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function displayName(u: { fullName: string | null; username: string }): string {
  return (u.fullName || '').trim() || u.username;
}

@Injectable()
export class ZaloLinkService {
  constructor(
    private readonly repo: ZaloLinkRepository,
    private readonly token: ZaloTokenService,
    private readonly activity: ActivityService,
  ) {}

  // Cấp mã kích hoạt cho user (ghi đè mã cũ nếu có). Trả mã + hạn + thông tin OA để hướng dẫn nhắn.
  async createZaloLinkCode(userId: string) {
    const uid = BigInt(userId);
    const user = await this.repo.findUser(uid);
    if (!user) throw new Error('Không tìm thấy người dùng.');

    // Dọn mã hết hạn (mọi user) — nhẹ, tiện tay.
    await this.repo.deleteExpiredRequests();

    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    let code = sixDigits();
    for (let i = 0; i < 5; i++) {
      const clash = await this.repo.findRequestClash(code);
      if (!clash || clash.userId === uid) break;
      code = sixDigits();
    }
    await this.repo.upsertRequest(uid, code, expiresAt);
    const st = await this.token.zaloStatus();
    return {
      code,
      expiresAt,
      oaId: st.oaId,
      oaName: st.oaName,
      oaConnected: st.connected,
      userName: displayName(user),
    };
  }

  // Trạng thái kích hoạt của 1 user (cho modal + cột Zalo ở màn Người dùng).
  async getZaloLinkStatus(userId: string) {
    const uid = BigInt(userId);
    const [binding, req, st] = await Promise.all([
      this.repo.findBindingByUser(uid),
      this.repo.findRequestByUser(uid),
      this.token.zaloStatus(),
    ]);
    const pending = req && req.expiresAt.getTime() > Date.now() ? { expiresAt: req.expiresAt } : null;
    return {
      linked: !!binding && binding.status === 'ACTIVE',
      zaloUserId: binding?.zaloUserId || '',
      zaloName: binding?.zaloName || '',
      linkedAt: binding?.linkedAt ?? null,
      pending,
      oaId: st.oaId,
      oaName: st.oaName,
      oaConnected: st.connected,
      tokenShared: st.source === 'shared', // dùng chung token với worker Go
      webhookLastAt: st.webhookLastAt, // null = web này chưa từng nhận webhook -> mã nhắn vào OA sẽ không tới
    };
  }

  // Huỷ kích hoạt: xoá binding + xoá kênh nhận ZALO tương ứng (không còn báo về Zalo đó nữa).
  async unlinkZalo(userId: string) {
    const uid = BigInt(userId);
    const binding = await this.repo.findBindingByUser(uid);
    await this.repo.deleteRequestsByUser(uid);
    if (!binding) return { ok: true, removed: false };
    await this.repo.removeBindingAndChannel(uid, binding.zaloUserId);
    await this.activity.logActivity({
      userId: uid,
      action: 'ZALO_HUY_KICH_HOAT',
      target: binding.zaloUserId,
      result: 'SUCCESS',
    });
    return { ok: true, removed: true };
  }

  // Webhook gọi khi user nhắn OA: text là mã 6 số đang chờ -> gắn. Trả user đã gắn, hoặc null nếu không phải mã.
  async consumeZaloLinkCode(text: string, zaloUserId: string, zaloName?: string | null) {
    const code = (text || '').trim();
    if (!/^\d{6}$/.test(code) || !zaloUserId) return null;
    const req = await this.repo.findRequestByCode(code);
    if (!req) return null;
    if (req.expiresAt.getTime() < Date.now()) {
      await this.repo.deleteRequest(req.userId).catch(() => {});
      return null;
    }

    const name = displayName(req.user);
    await this.repo.consumeLink({
      userId: req.userId,
      zaloUserId,
      zaloName,
      name,
      username: req.user.username,
    });
    await this.activity.logActivity({
      userId: req.userId,
      actorName: name,
      action: 'ZALO_KICH_HOAT',
      target: zaloUserId,
      result: 'SUCCESS',
      note: zaloName || null,
    });
    return { userId: req.userId, name, username: req.user.username };
  }

  // uid này có phải Zalo của một tài khoản đã kích hoạt không (để webhook không coi tin của nhân viên là phản hồi khách).
  async isLinkedZaloUser(zaloUserId: string): Promise<boolean> {
    if (!zaloUserId) return false;
    const b = await this.repo.findBindingStatus(zaloUserId);
    return !!b && b.status === 'ACTIVE';
  }
}
