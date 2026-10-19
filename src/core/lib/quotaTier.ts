// Map tier Meta -> số khách/24h. File THUẦN (không "server-only", không DB) — tách riêng để
// (1) test được bằng script chạy ngoài Next, (2) quotaService.ts dùng lại.
// Thang hạn mức từ 07/10/2025 (cấp business portfolio): 250 -> 2.000 -> 10K -> 100K -> Unlimited.
// Lưu ý: enum cũ có TIER_1K (1.000), TIER_50... vẫn giữ để tương thích dữ liệu cũ.

export const DEFAULT_LIMIT = 2000;

export const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: Infinity,
};

export function tierToLimit(tier: string | null | undefined): number {
  const t = (tier || "").toUpperCase();
  if (t === "TIER_UNLIMITED") return Infinity;
  return TIER_LIMITS[t] ?? DEFAULT_LIMIT;
}

// Hạn mức + CÓ BIẾT CHẮC HAY KHÔNG. Tách riêng vì `tierToLimit` trả 2.000 cho cả trường hợp
// "Meta bảo TIER_2K" lẫn "Meta không nói gì" — hai thứ khác hẳn nhau với người dùng.
//
// Thực tế đo được ngày 25/09/2026: Meta trả HTTP 200 nhưng KHÔNG hề có `messaging_limit_tier`
// (hạn mức đã chuyển lên cấp business portfolio từ 07/10/2025). Nếu coi đó là 2.000 chắc chắn
// thì màn Tổng quan hiện một con số bịa mà không ai biết là bịa.
export function resolveLimit(tier: string | null | undefined): { limit: number; unknown: boolean } {
  const t = (tier || "").trim().toUpperCase();
  if (!t) return { limit: DEFAULT_LIMIT, unknown: true };
  if (!(t in TIER_LIMITS)) return { limit: DEFAULT_LIMIT, unknown: true }; // tier lạ -> cũng là không biết
  return { limit: tierToLimit(t), unknown: false };
}
