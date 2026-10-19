import { Pool } from "pg";

// DÙNG CHUNG TOKEN ZALO VỚI WORKER GO (ago_order): web này KHÔNG tự cấp quyền / làm mới,
// chỉ ĐỌC access_token hiện hành từ bảng `zalo_oa_tokens` trong DB của worker Go
// (worker Go vẫn là người duy nhất đổi refresh_token -> không tranh chấp chuỗi token).
//
// Env: ZALO_TOKEN_SOURCE_DB_URL = connection string Postgres của DB worker Go (chỉ cần quyền SELECT).
// Bỏ trống = web này tự quản token riêng (luồng cấp quyền ở màn Zalo OA).
//
// Cột theo tài liệu worker Go: zalo_oa_tokens(oa_id, access_token, refresh_token, expires_at, updated_at),
//                              zalo_user_bindings(user_id, zalo_user_id, status, linked_at).

const CACHE_MS = 5 * 60 * 1000; // access_token Go xoay ~25h; đọc lại tối đa 5 phút/lần (hoặc ép khi -216)

export type SharedZaloToken = { oaId: string; accessToken: string; expiresAt: Date | null; updatedAt: Date | null };
export type SharedZaloBinding = { userId: string; zaloUserId: string; status: string; linkedAt: Date | null; name: string };

let pool: Pool | null = null;
let poolUrl = "";
let cache: { at: number; row: SharedZaloToken | null } | null = null;
let lastError = "";

function sourceUrl(): string {
  return (process.env.ZALO_TOKEN_SOURCE_DB_URL || "").trim();
}

export function isSharedZaloTokenConfigured(): boolean {
  return !!sourceUrl();
}

export function sharedZaloTokenError(): string {
  return lastError;
}

function getPool(): Pool {
  const url = sourceUrl();
  if (pool && poolUrl === url) return pool;
  const local = /localhost|127\.0\.0\.1|@db:/.test(url);
  const noSsl = /sslmode=disable/.test(url);
  pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    ssl: local || noSsl ? false : { rejectUnauthorized: false }, // Render/Supabase Postgres cần SSL
  });
  poolUrl = url;
  return pool;
}

// Đọc token hiện hành của worker Go. force=true bỏ cache (dùng khi Zalo báo -216 — Go vừa xoay token).
export async function readSharedZaloToken(force = false): Promise<SharedZaloToken | null> {
  if (!isSharedZaloTokenConfigured()) return null;
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.row;
  try {
    const r = await getPool().query(
      // epoch: đúng bất kể cột là timestamp (không múi giờ, Go ghi UTC) hay timestamptz — tránh pg đọc lệch theo giờ máy.
      `SELECT oa_id, access_token,
              extract(epoch FROM expires_at)::float8 AS expires_epoch,
              extract(epoch FROM updated_at)::float8 AS updated_epoch
         FROM zalo_oa_tokens
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
    );
    const row = r.rows[0] as { oa_id?: unknown; access_token?: unknown; expires_epoch?: number | null; updated_epoch?: number | null } | undefined;
    const out: SharedZaloToken | null = row?.access_token
      ? {
          oaId: String(row.oa_id ?? ""),
          accessToken: String(row.access_token),
          expiresAt: row.expires_epoch ? new Date(row.expires_epoch * 1000) : null,
          updatedAt: row.updated_epoch ? new Date(row.updated_epoch * 1000) : null,
        }
      : null;
    cache = { at: Date.now(), row: out };
    lastError = out ? "" : "Bảng zalo_oa_tokens bên worker Go chưa có dòng token nào (worker Go chưa bootstrap?).";
    return out;
  } catch (err) {
    lastError = "Không đọc được DB worker Go: " + (err instanceof Error ? err.message : String(err));
    console.error("[zaloShared]", lastError);
    // Lỗi mạng tạm thời -> dùng lại token cache cũ nếu còn (đỡ gãy gửi tin).
    return cache?.row ?? null;
  }
}

// Danh sách người đã liên kết Zalo bên worker Go (mã 6 số bên đó) -> tiện thêm làm kênh nhận ở đây.
export async function listSharedZaloBindings(): Promise<SharedZaloBinding[]> {
  if (!isSharedZaloTokenConfigured()) return [];
  try {
    const r = await getPool().query(
      `SELECT user_id, zalo_user_id, status, extract(epoch FROM linked_at)::float8 AS linked_epoch
         FROM zalo_user_bindings
        ORDER BY linked_at DESC
        LIMIT 50`,
    );
    const rows = r.rows as { user_id: unknown; zalo_user_id: unknown; status: unknown; linked_epoch: number | null }[];
    const out: SharedZaloBinding[] = rows.map((b) => ({
      userId: String(b.user_id ?? ""),
      zaloUserId: String(b.zalo_user_id ?? ""),
      status: String(b.status ?? ""),
      linkedAt: b.linked_epoch ? new Date(b.linked_epoch * 1000) : null,
      name: "",
    }));
    // Tên người dùng bên Go (bảng users) — không biết chắc schema nên thử, lỗi thì bỏ qua.
    try {
      const ids = out.map((b) => b.userId).filter(Boolean);
      if (ids.length) {
        const u = await getPool().query(`SELECT id, username, full_name FROM users WHERE id = ANY($1::bigint[])`, [ids]);
        const byId = new Map((u.rows as { id: unknown; username?: unknown; full_name?: unknown }[]).map((x) => [String(x.id), String(x.full_name || x.username || "")]));
        for (const b of out) b.name = byId.get(b.userId) || "";
      }
    } catch {
      // schema users khác -> chỉ hiện user_id
    }
    return out;
  } catch (err) {
    console.error("[zaloShared] đọc zalo_user_bindings lỗi:", err instanceof Error ? err.message : err);
    return [];
  }
}
