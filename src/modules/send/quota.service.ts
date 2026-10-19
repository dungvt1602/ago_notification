import { Injectable } from '@nestjs/common';
import { tierToLimit, resolveLimit } from '@core/lib/quotaTier';
import { MetaSyncService } from '../templates/meta-sync.service';
import type { PhoneHealth } from '../templates/meta-sync.service';
import { QuotaRepository } from './quota.repository';

// HẠN MỨC GỬI META — dùng chung cho Việc 2 (hiển thị) và Việc 3 (chặn gửi vượt).
//
// Meta KHÔNG có API đọc "đã dùng bao nhiêu" -> app phải TỰ ĐẾM. Hạn mức tính theo
// business-initiated conversation với KHÁCH DUY NHẤT trong cửa sổ 24h cuốn (không phải số
// tin), và từ 07/10/2025 là cấp BUSINESS PORTFOLIO (dùng chung mọi số, kể cả bot Go / hệ
// thống khác). App chỉ đếm được tin do APP gửi -> SAFETY_RATIO chừa khoảng trống an toàn.
export { tierToLimit };

// Chừa khoảng trống an toàn. Mặc định 0.9 (dùng tối đa 1800/2000). Chỉnh bằng QUOTA_SAFETY_RATIO.
function safetyRatio(): number {
  const v = Number(process.env.QUOTA_SAFETY_RATIO || 0.9);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.9;
}

export type QuotaState = {
  limit: number; // hạn mức thật (từ tier Meta) — xem limitUnknown trước khi tin con số này
  safeLimit: number; // hạn mức sau khi chừa margin = limit * safetyRatio
  used24h: number; // số khách DUY NHẤT đã nhận tin thành công trong 24h qua (app tự đếm)
  remaining: number; // còn lại = max(0, safeLimit - used24h); Infinity khi không giới hạn
  qualityRating: string | null;
  tier: string | null;
  limitUnknown: boolean; // true = KHÔNG biết hạn mức thật -> đang giả định DEFAULT_LIMIT
  numberStatus: string | null; // CONNECTED = số gửi được; khác đi là số đang có vấn đề
  fetchedAt: string | null; // lúc đọc từ Meta (cache 10 phút) — để UI nói rõ số liệu cũ tới đâu
  health: PhoneHealth | null;
};

// Cache ngắn 30s để worker (poll 8s) không chạy COUNT liên tục khi nhàn rỗi.
const USED_CACHE_MS = 30 * 1000;

@Injectable()
export class QuotaService {
  // Cache cấp tiến trình (service là singleton) — giữ nguyên ngữ nghĩa biến module-level cũ.
  private usedCache: { at: number; value: number } = { at: 0, value: 0 };

  constructor(
    private readonly repo: QuotaRepository,
    private readonly metaSync: MetaSyncService,
  ) {}

  // Đếm số khách DUY NHẤT đã nhận tin thành công trong 24h qua.
  async countUsed24h(force = false): Promise<number> {
    if (!force && Date.now() - this.usedCache.at < USED_CACHE_MS) return this.usedCache.value;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.repo.countDistinctSentSince(since);
    const value = Number(rows[0]?.count ?? 0);
    this.usedCache = { at: Date.now(), value };
    return value;
  }

  async getQuotaState(force = false): Promise<QuotaState> {
    const [health, used24h] = await Promise.all([
      this.metaSync.getPhoneNumberHealth(),
      this.countUsed24h(force),
    ]);
    const tier = health?.messagingLimitTier || null;
    const { limit, unknown: tierUnknown } = resolveLimit(tier);
    const safeLimit = limit === Infinity ? Infinity : Math.floor(limit * safetyRatio());
    const remaining = safeLimit === Infinity ? Infinity : Math.max(0, safeLimit - used24h);
    return {
      limit,
      safeLimit,
      used24h,
      remaining,
      qualityRating: health?.qualityRating || null,
      tier,
      // Meta đã bỏ `messaging_limit_tier` khỏi node phone number -> không đọc được tier = KHÔNG biết
      // hạn mức thật, phải nói thẳng ra cho người dùng thay vì hiện số tự đoán.
      limitUnknown: !health || tierUnknown,
      numberStatus: health?.status || null,
      fetchedAt: health?.fetchedAt || null,
      health,
    };
  }
}
