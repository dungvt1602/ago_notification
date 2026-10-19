/*
 * Cấu hình harness parity Next <-> Nest.
 *
 * AN TOÀN: harness CHỈ được chạm DB Docker throwaway `baogia-parity-pg`
 *   postgresql://parity:parity@127.0.0.1:55432/baogia_parity
 * và KHÔNG BAO GIỜ đọc/in giá trị trong .env của app Next (trỏ production).
 * Chỉ đọc TÊN biến từ file đó (từng dòng, bỏ ngay phần giá trị) để vô hiệu hoá chúng trong env của tiến trình con.
 */
import fs from 'node:fs';
import path from 'node:path';

export const TEST_DB_URL = 'postgresql://parity:parity@127.0.0.1:55432/baogia_parity';

// Bản sao riêng của app Next (build production, KHÔNG có .env) — xem README harness.
export const NEXT_DIR = path.resolve(process.env.PARITY_NEXT_DIR || path.join(__dirname, '../../../_parity_next'));
export const NEST_DIR = path.resolve(__dirname, '../..');
export const NEXT_PORT = 3999;
export const NEST_PORT = 4455;
export const LOG_DIR = path.join(__dirname, 'logs');

export const ZALO_APP_ID = 'parity-app';
export const ZALO_WEBHOOK_SECRET = 'parity-secret';
export const WA_VERIFY_TOKEN = 'parity-verify';
export const APP_BASE_URL = 'http://parity.invalid';

/** Refuse to run unless the DB is exactly the throwaway one. */
export function assertSafeDbUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('PARITY ABORT: DATABASE_URL không parse được.');
  }
  const db = u.pathname.replace(/^\//, '');
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || db !== 'baogia_parity') {
    throw new Error(
      `PARITY ABORT: DATABASE_URL phải là 127.0.0.1:55432/baogia_parity (nhận: host=${u.hostname} port=${u.port} db=${db}).`,
    );
  }
  return url;
}

// Chỉ cho phép override qua biến RIÊNG của harness (không bao giờ đọc DATABASE_URL của shell/.env).
export const DATABASE_URL = assertSafeDbUrl(process.env.PARITY_DATABASE_URL || TEST_DB_URL);

/** Tên biến trong .env của Next — đọc TÊN thôi, giá trị bị bỏ ngay trên từng dòng. */
function envNamesOf(file: string): string[] {
  const names: string[] = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m) names.push(m[1]);
    }
  } catch {
    /* không có file -> dùng danh sách cứng bên dưới */
  }
  return names;
}

const KNOWN_ENV_NAMES = [
  'DATABASE_URL', 'DIRECT_URL', 'TELEGRAM_BOT_TOKEN_MAIN', 'ZALO_OA_TOKEN_MAIN', 'WHATSAPP_TOKEN_MAIN',
  'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_API_VERSION', 'SEND_DRY_RUN', 'SEND_WORKER_POLL_MS',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'ZALO_APP_ID', 'ZALO_SECRET_KEY',
  'ZALO_WEBHOOK_SECRET', 'ZALO_OA_ID', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_TOKEN_SOURCE_DB_URL',
  'ZALO_WEBHOOK_FORWARD_URL',
  // Không có trong .env nhưng app đọc -> ép rỗng cho chắc.
  'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOSS_CHAT_ID', 'TRACKING_RELAY_SECRET', 'WHATSAPP_WEBHOOK_FORWARD_URL',
  'ZALO_BOSS_USER_ID', 'WHATSAPP_WABA_ID', 'ZALO_OA_SECRET', 'ZALO_OAUTH_CALLBACK_URL', 'WHATSAPP_VERIFY_TOKEN',
  'AUTO_REPLY_COOLDOWN_MIN', 'QUOTA_SAFETY_RATIO', 'ACTIVITY_LOG_DAYS', 'CORS_ORIGINS',
];

const PASS_THROUGH = new Set([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT',
  'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'PROGRAMFILES', 'PROGRAMDATA',
  'COMMONPROGRAMFILES', 'SYSTEMDRIVE',
]);

/** Env sạch cho tiến trình con (Next / Nest). */
export function buildChildEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (PASS_THROUGH.has(k.toUpperCase()) && v !== undefined) env[k] = v;
  }
  const names = new Set([...KNOWN_ENV_NAMES, ...envNamesOf(path.join(NEXT_DIR, '.env'))]);
  for (const n of names) env[n] = ''; // .env của Next KHÔNG thể ghi đè: biến đã định nghĩa (kể cả rỗng) thắng.
  Object.assign(env, {
    DATABASE_URL,
    DIRECT_URL: DATABASE_URL,
    SEND_DRY_RUN: 'true',
    SEND_WORKER_DISABLED: 'true',
    ZALO_APP_ID,
    ZALO_WEBHOOK_SECRET,
    WHATSAPP_VERIFY_TOKEN: WA_VERIFY_TOKEN,
    APP_BASE_URL,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    // Dây an toàn: mọi HTTP ra ngoài (fetch) bị đẩy vào proxy chết -> thất bại ngay, KHÔNG thể có tin thật.
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  });
  return env;
}
