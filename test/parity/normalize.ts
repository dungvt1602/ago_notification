import type { RawResult } from './http';

const ISO_FULL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const ISO_ANY = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z?$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const BGCODE = /BG\d{12,14}/g;
const BCRYPT = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;
const ORIGIN = /http:\/\/(?:127\.0\.0\.1|localhost):(?:3999|4455)/g;

/**
 * Lỗi Prisma kèm "khung code" chứa đường dẫn + dòng nguồn của app gọi (Turbopack vs dist/*.js) -> luôn khác
 * giữa hai app dù cùng lỗi. Chỉ GIỮ đoạn thông điệp cuối (sau dòng trống cuối cùng).
 * (Cosmetic, chuẩn hoá có chủ đích — được liệt kê trong báo cáo.)
 */
function stripPrismaFrame(s: string): string {
  if (!/^\s*Invalid `/.test(s) || !/ invocation in\n/.test(s)) return s;
  const tail = s.split('\n').pop() ?? s;
  return 'Invalid <prisma-call> invocation: ' + tail.trim();
}

export function normString(s: string): string {
  s = stripPrismaFrame(s);
  if (ISO_FULL.test(s)) {
    const m = MIDNIGHT.exec(s);
    return m ? m[1] : '<TS>'; // nửa đêm UTC = cột @db.Date -> giữ phần ngày
  }
  return s
    .replace(ISO_ANY, '<TS>')
    .replace(UUID, '<UUID>')
    .replace(BGCODE, '<BGCODE>')
    .replace(BCRYPT, '<BCRYPT>')
    .replace(ORIGIN, '<ORIGIN>');
}

export function normalize(v: unknown, maskKeys: string[] = [], sortArrays: string[] = []): unknown {
  if (typeof v === 'string') return normString(v);
  if (Array.isArray(v)) return v.map((x) => normalize(x, maskKeys, sortArrays));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      let nv = maskKeys.includes(k) && val != null ? '<MASKED>' : normalize(val, maskKeys, sortArrays);
      if (sortArrays.includes(k) && Array.isArray(nv)) nv = [...nv].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      o[k] = nv;
    }
    return o;
  }
  return v;
}

export interface StepView {
  status: number;
  media: string;
  headers: Record<string, string>;
  body: unknown;
}

const KEEP_HEADERS = ['location', 'cache-control', 'content-disposition'];

export function viewOf(r: RawResult, maskKeys: string[] = [], sortArrays: string[] = []): StepView {
  const headers: Record<string, string> = {};
  for (const h of KEEP_HEADERS) if (r.headers[h] !== undefined) headers[h] = normString(r.headers[h]);
  let body: unknown;
  if (r.error) body = { __transportError: r.error };
  else if (r.json !== undefined) body = normalize(r.json, maskKeys, sortArrays);
  else if (r.text !== undefined) body = normString(r.text);
  else if (r.binary) body = { __binary: r.binary };
  else body = null;
  return { status: r.status, media: r.contentType.split(';')[0].trim().toLowerCase(), headers, body };
}

export interface Diff {
  path: string;
  next: unknown;
  nest: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepDiff(a: unknown, b: unknown, path = '', out: Diff[] = [], limit = 60): Diff[] {
  if (out.length >= limit) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: path + '.length', next: a.length, nest: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (!(k in a)) out.push({ path: `${path}.${k}`, next: '<absent>', nest: b[k] });
      else if (!(k in b)) out.push({ path: `${path}.${k}`, next: a[k], nest: '<absent>' });
      else deepDiff(a[k], b[k], `${path}.${k}`, out, limit);
    }
    return out;
  }
  if (a !== b) out.push({ path: path || '(root)', next: a, nest: b });
  return out;
}

export type Dump = Record<string, Record<string, unknown>[]>;

/** Chuẩn hoá dump DB (che các cột ngẫu nhiên). */
export function normalizeDump(d: Dump): Dump {
  const out: Dump = {};
  for (const [t, rows] of Object.entries(d)) {
    out[t] = rows.map((row) => {
      const r = normalize(row) as Record<string, unknown>;
      if (t === 'zalo_link_requests' && r.code != null) r.code = '<MASKED>';
      if (t === 'app_settings' && typeof r.key === 'string' && /^zalo_pkce_(verifier|state)$/.test(r.key)) r.value = '<MASKED>';
      return r;
    });
  }
  return out;
}

export function dumpDiff(a: Dump, b: Dump, pkOf: (t: string) => string[], limit = 80): string[] {
  const lines: string[] = [];
  const fmt = (v: unknown) => {
    const s = JSON.stringify(v);
    return s && s.length > 140 ? s.slice(0, 140) + '…' : s;
  };
  for (const t of Object.keys(a).sort()) {
    const ra = a[t] ?? [];
    const rb = b[t] ?? [];
    const key = (r: Record<string, unknown>) => pkOf(t).map((c) => `${c}=${String(r[c])}`).join(',') || JSON.stringify(r);
    const ma = new Map(ra.map((r) => [key(r), r]));
    const mb = new Map(rb.map((r) => [key(r), r]));
    if (ra.length !== rb.length) lines.push(`${t}: row count next=${ra.length} nest=${rb.length}`);
    for (const [k, r] of ma) {
      const o = mb.get(k);
      if (!o) {
        lines.push(`${t}[${k}]: only in NEXT ${fmt(r)}`);
        continue;
      }
      for (const d of deepDiff(r, o)) lines.push(`${t}[${k}]${d.path}: next=${fmt(d.next)} nest=${fmt(d.nest)}`);
    }
    for (const [k, r] of mb) if (!ma.has(k)) lines.push(`${t}[${k}]: only in NEST ${fmt(r)}`);
    if (lines.length >= limit) {
      lines.push('… (truncated)');
      break;
    }
  }
  return lines;
}
