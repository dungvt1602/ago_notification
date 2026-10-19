import { FIELD_LABELS } from '@shared/activityLabels';
import type { ReqLike } from '@core/http/reqLike';

export type Actor = { id: string | null; name: string | null };

export function actorFromRequest(req?: ReqLike | null): Actor {
  const rawId = req?.headers.get('x-actor-id') || '';
  const rawName = req?.headers.get('x-actor-name') || '';
  let name: string | null = null;
  try {
    name = rawName ? decodeURIComponent(rawName) : null;
  } catch {
    name = rawName || null;
  }
  return { id: /^\d+$/.test(rawId) ? rawId : null, name };
}

// ---------- Mô tả "đã đổi gì" khi sửa ----------

function fmtVal(v: unknown): string {
  if (v == null || v === '') return '(trống)';
  if (typeof v === 'boolean') return v ? 'có' : 'không';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    // Decimal của Prisma / object khác
    const s =
      typeof (v as { toString?: () => string }).toString === 'function'
        ? (v as { toString: () => string }).toString()
        : JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && typeof b === 'string') return a.toISOString().slice(0, 10) === b.slice(0, 10);
  if (a != null && typeof a === 'object' && !(a instanceof Date)) return String(a) === String(b ?? '');
  return String(a ?? '') === String(b ?? '');
}

// So input (những trường client gửi lên) với bản ghi trước khi sửa -> "tên: A → B; SĐT: x → y".
// Trường không có trong input hoặc không đổi -> bỏ qua. Mật khẩu chỉ ghi "đổi mật khẩu".
export function diffSummary(
  before: Record<string, unknown> | null | undefined,
  input: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'password') {
      if (v) parts.push('đổi mật khẩu');
      continue;
    }
    if (before && k in before && same(before[k], v)) continue;
    const label = FIELD_LABELS[k] || k;
    parts.push(
      before && k in before ? `${label}: ${fmtVal(before[k])} → ${fmtVal(v)}` : `${label}: ${fmtVal(v)}`,
    );
  }
  const s = parts.join('; ');
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

export type Model = 'customer' | 'template' | 'quotation' | 'user' | 'channel' | 'receiveChannel';

// Tên hiển thị đối tượng cho cột "Đối tượng".
export function labelOf(
  model: Model,
  row: Record<string, unknown> | null | undefined,
  fallbackId?: string,
): string {
  if (!row) return fallbackId ? `#${fallbackId}` : '';
  const s = (k: string) => (row[k] == null ? '' : String(row[k]));
  switch (model) {
    case 'customer':
      return [s('name'), s('company')].filter(Boolean).join(' · ') || `#${s('id')}`;
    case 'template':
      return s('name') || `#${s('id')}`;
    case 'quotation':
      return [s('code'), s('title')].filter(Boolean).join(' · ') || `#${s('id')}`;
    case 'user':
      return s('fullName') ? `${s('fullName')} (${s('username')})` : s('username') || `#${s('id')}`;
    case 'channel':
    case 'receiveChannel':
      return [s('name'), s('type')].filter(Boolean).join(' · ') || `#${s('id')}`;
  }
}
