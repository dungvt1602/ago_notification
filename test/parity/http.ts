import crypto from 'node:crypto';

export interface StepSpec {
  name: string;
  method: string;
  /** Đường dẫn SAU /api, vd '/users' hoặc '/customers/search?page=2'. */
  path: string;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  bytes?: Buffer;
  contentType?: string;
  /** Không gắn header x-actor-*. */
  noActor?: boolean;
  /** Tên khoá JSON cần che (giá trị ngẫu nhiên) trong body trả về của riêng bước này. */
  maskKeys?: string[];
  /** Khoá JSON có giá trị là mảng KHÔNG có thứ tự bảo đảm (vd groupBy không orderBy) -> sắp lại trước khi so. */
  sortArrays?: string[];
  /** Đợi sau bước (ms). */
  sleepAfter?: number;
  /** Lấy giá trị từ response (JSON thô, chưa chuẩn hoá) để dùng ở bước sau. */
  capture?: (r: RawResult, vars: Vars) => void;
  /** Lặp bước (vd POST /send/process) tới khi until() đúng hoặc đủ max. */
  repeat?: { max: number; until: (r: RawResult) => boolean };
  /** Cho phép bước chạy > mặc định. */
  timeoutMs?: number;
}

export type Vars = Record<string, unknown>;
export type StepOrFn = StepSpec | ((vars: Vars) => StepSpec);

export interface RawResult {
  status: number;
  headers: Record<string, string>;
  contentType: string;
  /** JSON đã parse nếu content-type JSON, ngược lại undefined. */
  json?: unknown;
  /** Text nếu content-type dạng text/*, ngược lại undefined. */
  text?: string;
  /** Hash + độ dài nếu nhị phân. */
  binary?: { sha256: string; bytes: number };
  ms: number;
  error?: string;
}

export const ACTOR_HEADERS = {
  'x-actor-id': '1',
  'x-actor-name': encodeURIComponent('Quản trị viên'),
};

export async function doRequest(base: string, s: StepSpec): Promise<RawResult> {
  const headers: Record<string, string> = { ...(s.noActor ? {} : ACTOR_HEADERS), ...(s.headers ?? {}) };
  let body: string | Buffer | undefined;
  if (s.json !== undefined) {
    body = JSON.stringify(s.json);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  } else if (s.text !== undefined) {
    body = s.text;
    if (s.contentType) headers['content-type'] = s.contentType;
  } else if (s.bytes !== undefined) {
    body = s.bytes;
    if (s.contentType) headers['content-type'] = s.contentType;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(base + '/api' + s.path, {
      method: s.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(s.timeoutMs ?? 180_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    const contentType = h['content-type'] ?? '';
    const r: RawResult = { status: res.status, headers: h, contentType, ms: Date.now() - t0 };
    const media = contentType.split(';')[0].trim().toLowerCase();
    if (media.includes('json')) {
      const txt = buf.toString('utf8');
      try {
        r.json = JSON.parse(txt);
      } catch {
        r.text = txt;
      }
    } else if (media.startsWith('text/') || media === '') {
      r.text = buf.toString('utf8');
    } else {
      r.binary = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
    }
    return r;
  } catch (e) {
    return { status: -1, headers: {}, contentType: '', ms: Date.now() - t0, error: (e as Error).message };
  }
}
