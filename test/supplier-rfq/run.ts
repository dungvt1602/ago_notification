/*
 * Test tích hợp PLAN-0001 (RFQ nhà cung cấp qua Zalo): chạy toàn bộ luồng qua HTTP trên BE THẬT + Postgres Docker
 * throwaway + Zalo GIẢ. Chạy: `npm run test:rfq` (cần Docker và đã có image postgres:18).
 *
 * AN TOÀN:
 *  - DB chỉ là container `baogia-rfq-pg` ở 127.0.0.1:55434/rfq — mọi chỗ dùng DB đều qua assertSafeDbUrl().
 *  - KHÔNG gọi Zalo/WhatsApp/Telegram thật: ZALO_API_BASE trỏ vào server giả 127.0.0.1:55435.
 *  - BE con nhận env SẠCH (không kế thừa env của shell, không đọc .env nào).
 *  - Dọn: dừng BE + Zalo giả, gỡ container (kể cả khi lỗi), thoát mã khác 0 nếu có assert sai.
 */
/* Phản hồi JSON của BE được đọc động (any) để assert gọn — chủ đích, chỉ trong script test này. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { Client } from 'pg';

const DB_URL = 'postgresql://rfq:rfq@127.0.0.1:55434/rfq';
const CONTAINER = 'baogia-rfq-pg';
const BE_PORT = 4488;
const BE2_PORT = 4489; // BE thứ hai KHÔNG có APP_BASE_URL
const ZALO_PORT = 55435;
const BASE = `http://127.0.0.1:${BE_PORT}`;
const ROOT = path.resolve(__dirname, '../..');
const ACTOR = { 'x-actor-id': '1', 'x-actor-name': encodeURIComponent('Tester') };

function assertSafeDbUrl(url: string): string {
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, '');
  if (u.hostname !== '127.0.0.1' || u.port !== '55434' || db !== 'rfq') {
    throw new Error(`RFQ TEST ABORT: DB phải là 127.0.0.1:55434/rfq (nhận ${u.hostname}:${u.port}/${db}).`);
  }
  return url;
}
assertSafeDbUrl(DB_URL);

// ---------- tiện ích ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
let checks = 0;
function check(cond: unknown, label: string, extra?: unknown): void {
  checks++;
  if (cond) return;
  failures.push(label);
  console.error(`  FAIL: ${label}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
}
const step = (s: string) => console.log(`\n== ${s}`);

function sh(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function listenersOnPort(port: number): number[] {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    return out
      .split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
  } catch {
    return [];
  }
}
function killByPort(port: number): void {
  for (const pid of listenersOnPort(port)) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* đã chết */
    }
  }
}

// ---------- Zalo giả ----------
type ZaloCall = {
  path: string;
  token: string | undefined;
  userId: string;
  kind: 'buttons' | 'text';
  body: unknown;
};
const zaloCalls: ZaloCall[] = [];
let buttonsFailCode: number | null = -1; // tin có nút kế tiếp bị từ chối bằng mã này (1 lần) -> thử đường lùi/không lùi
const ZALO_MESSAGES: Record<number, string> = {
  [-1]: 'Invalid button url (fake)',
  [-230]: 'User has not interacted with the OA in the past 7 days (fake)',
};
// Tin ảnh riêng không tính vào zaloCalls (để các phép đếm tin báo giá giữ nguyên) mà ghi ở đây.
const imageCalls: ZaloCall[] = [];
const failImageUsers = new Set<string>();
const callOrder: Array<{ kind: string; userId: string }> = [];
// Tra SĐT -> user_id (GET /v3.0/oa/user/detail): chỉ SĐT này (đã chuẩn hoá 84...) được Zalo giả nhận ra.
const KNOWN_PHONE = '84900000001';
const RESOLVED_ID = '777777777777777777';
const detailCalls: Array<{ token: string | undefined; phone: string }> = [];
const failUsers = new Set<string>(); // user_id luôn bị từ chối (cả list lẫn text)
const delayUsers = new Set<string>(); // user_id trả lời chậm 400ms (để thử gửi đồng thời)
let zaloServer: http.Server;

function startFakeZalo(): Promise<void> {
  zaloServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let delayMs = 0;
      const reply = (obj: unknown) => {
        if (delayMs > 0) {
          const d = delayMs;
          delayMs = 0;
          setTimeout(() => reply(obj), d);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'POST' && req.url === '/v3.0/oa/message/cs') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          recipient: { user_id: string };
          message: Record<string, unknown>;
        };
        const att = body.message.attachment as { payload?: { template_type?: string } } | undefined;
        const isImage = att?.payload?.template_type === 'media';
        const kind = isImage ? 'image' : att ? 'buttons' : 'text';
        const userId = body.recipient.user_id;
        callOrder.push({ kind, userId });
        if (delayUsers.has(userId)) delayMs = 400;
        (isImage ? imageCalls : zaloCalls).push({
          path: req.url,
          token: req.headers['access_token'] as string | undefined,
          userId,
          kind: kind as 'buttons' | 'text',
          body,
        });
        if (isImage && failImageUsers.has(userId))
          return reply({ error: -1, message: 'Invalid media (fake)' });
        if (userId === '000') return reply({ error: -232, message: 'User has not interacted (fake)' });
        if (failUsers.has(userId)) return reply({ error: -1, message: 'Forced failure (fake)' });
        if (kind === 'buttons' && buttonsFailCode !== null) {
          const code = buttonsFailCode;
          buttonsFailCode = null;
          return reply({ error: code, message: ZALO_MESSAGES[code] ?? 'fake error' });
        }
        return reply({
          error: 0,
          message: 'Success',
          data: { message_id: `FAKE-${zaloCalls.length}`, user_id: userId },
        });
      }
      if (req.method === 'GET' && (req.url ?? '').startsWith('/v3.0/oa/user/detail')) {
        const q = new URL(req.url ?? '', 'http://x').searchParams.get('data') ?? '{}';
        const phone = (JSON.parse(q) as { user_id?: string }).user_id ?? '';
        detailCalls.push({ token: req.headers['access_token'] as string | undefined, phone });
        if (phone === KNOWN_PHONE)
          return reply({ error: 0, message: 'Success', data: { user_id: RESOLVED_ID } });
        return reply({ error: -232, message: "User hasn't interacted yet" });
      }
      res.writeHead(404);
      res.end('fake zalo: not found');
    });
  });
  return new Promise((resolve, reject) => {
    zaloServer.once('error', reject);
    zaloServer.listen(ZALO_PORT, '127.0.0.1', () => resolve());
  });
}

// ---------- HTTP helper ----------
type Res = { status: number; json: any; text: string; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(
  method: string,
  url: string,
  body?: unknown,
  opts: {
    actor?: boolean;
    raw?: Buffer;
    contentType?: string;
    ip?: string;
    headers?: Record<string, string>;
    base?: string;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    ...(opts.actor === false ? {} : ACTOR),
    ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}),
    ...(opts.headers ?? {}),
  };
  let payload: BodyInit | undefined;
  if (opts.raw) {
    headers['content-type'] = opts.contentType ?? 'application/octet-stream';
    payload = new Uint8Array(opts.raw);
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch((opts.base ?? BASE) + url, { method, headers, body: payload });
  const text = await r.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  return { status: r.status, json, text, headers: r.headers };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const tokenOf = (link: string) => link.split('/ncc/')[1];

// ---------- chạy ----------
let be: ChildProcess | null = null;
let be2: ChildProcess | null = null;
let db: Client | null = null;

async function cleanup(): Promise<void> {
  try {
    await db?.end();
  } catch {
    /* bỏ qua */
  }
  try {
    be?.kill();
  } catch {
    /* bỏ qua */
  }
  killByPort(BE_PORT);
  try {
    be2?.kill();
  } catch {
    /* bỏ qua */
  }
  killByPort(BE2_PORT);
  try {
    zaloServer?.close();
  } catch {
    /* bỏ qua */
  }
  killByPort(ZALO_PORT);
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  } catch {
    /* container không tồn tại */
  }
}

async function main(): Promise<void> {
  for (const p of [BE_PORT, BE2_PORT, ZALO_PORT, 55434]) {
    // Cổng DB có thể còn container cũ của chính harness này -> gỡ trước rồi mới kiểm tra.
    if (p === 55434) {
      try {
        execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
      } catch {
        /* chưa có */
      }
      await sleep(1000);
    }
    const l = listenersOnPort(p);
    if (l.length)
      throw new Error(
        `RFQ TEST ABORT: cổng ${p} đang bị tiến trình ${l.join(',')} chiếm — không kill, dừng.`,
      );
  }

  step('Postgres tạm + prisma db push');
  sh('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    'POSTGRES_USER=rfq',
    '-e',
    'POSTGRES_PASSWORD=rfq',
    '-e',
    'POSTGRES_DB=rfq',
    '-p',
    '127.0.0.1:55434:5432',
    'postgres:18',
  ]);
  for (let i = 0; ; i++) {
    try {
      sh('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'rfq', '-d', 'rfq']);
      // pg_isready báo sớm trong lúc initdb khởi động tạm -> thử kết nối thật qua cổng đã publish.
      const probe = new Client({ connectionString: assertSafeDbUrl(DB_URL) });
      await probe.connect();
      await probe.end();
      break;
    } catch {
      if (i > 60) throw new Error('Postgres không sẵn sàng');
      await sleep(1000);
    }
  }
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    DATABASE_URL: assertSafeDbUrl(DB_URL),
    DIRECT_URL: assertSafeDbUrl(DB_URL),
  };
  sh(process.execPath, [path.join(ROOT, 'node_modules/prisma/build/index.js'), 'db', 'push'], baseEnv);

  step('Build BE');
  sh(process.execPath, [path.join(ROOT, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
  });

  step('Khởi động Zalo giả + BE');
  await startFakeZalo();
  db = new Client({ connectionString: assertSafeDbUrl(DB_URL) });
  await db.connect();
  // Env SẠCH: chỉ những biến test cần (không kế thừa env cha, không .env).
  const beEnv: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    PORT: String(BE_PORT),
    DATABASE_URL: assertSafeDbUrl(DB_URL),
    SEND_WORKER_DISABLED: 'true',
    SEND_DRY_RUN: 'false',
    ZALO_API_BASE: `http://127.0.0.1:${ZALO_PORT}`,
    ZALO_OA_TOKEN_MAIN: 'fake-token',
    APP_BASE_URL: 'http://app.test',
  };
  be = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: ROOT,
    env: beEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200) break;
    } catch {
      /* chưa lên */
    }
    if (i > 60) throw new Error('BE không lên');
    await sleep(1000);
  }

  // BE thứ hai: cùng DB/Zalo giả nhưng KHÔNG đặt APP_BASE_URL (kiểm tra từ chối tạo link).
  const env2: NodeJS.ProcessEnv = { ...beEnv, PORT: String(BE2_PORT) };
  delete env2.APP_BASE_URL;
  be2 = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: ROOT,
    env: env2,
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true,
  });
  const BASE2 = `http://127.0.0.1:${BE2_PORT}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${BASE2}/api/health`)).status === 200) break;
    } catch {
      /* chưa lên */
    }
    if (i > 60) throw new Error('BE2 không lên');
    await sleep(1000);
  }

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await (db as Client).query(sql, params)).rows as T[];

  // ===== Nhà cung cấp =====
  step('Nhà cung cấp CRUD');
  const A = (
    await call('POST', '/api/suppliers', {
      name: 'NCC Alpha',
      company: 'Alpha Co',
      zaloUserId: '111111111111111111',
    })
  ).json;
  const B = (await call('POST', '/api/suppliers', { name: 'NCC Beta', zaloUserId: '222222222222222222' }))
    .json;
  const N = (await call('POST', '/api/suppliers', { name: 'NCC NoZalo', phone: '0900000000' })).json;
  check(A?.id && B?.id && N?.id && A.status === 'ACTIVE', 'tạo 3 NCC', [A, B, N]);
  check((await call('POST', '/api/suppliers', { name: ' ' })).status === 400, 'NCC tên rỗng -> 400');
  check(
    (await call('POST', '/api/suppliers', { name: 'x', zaloUserId: 'abc' })).status === 400,
    'zaloUserId không phải số -> 400',
  );
  const lst = await call('GET', '/api/suppliers?search=alpha');
  check(
    lst.status === 200 && lst.json.length === 1 && lst.json[0].name === 'NCC Alpha',
    'tìm NCC theo tên',
    lst.json,
  );
  const pa = await call('PATCH', `/api/suppliers/${N.id}`, { note: 'ghi chú' });
  check(
    pa.status === 200 && pa.json.note === 'ghi chú' && pa.json.name === 'NCC NoZalo',
    'PATCH một phần',
    pa.json,
  );
  check(
    (await call('PATCH', '/api/suppliers/999999', { note: 'x' })).status === 404,
    'PATCH NCC không tồn tại -> 404',
  );

  // ===== RFQ =====
  step('RFQ: tạo, mã, mặt hàng, ảnh');
  const year = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const rfqBody = {
    title: 'Xoài cát Hoà Lộc',
    note: 'Giao tại Cần Thơ',
    currency: 'VND',
    deadline,
    items: [
      { product: 'Xoài loại 1', unit: 'kg', quantity: 1000, spec: '350-400g/trái' },
      { product: 'Xoài loại 2', unit: 'kg', quantity: '500.5' },
    ],
  };
  const r1 = await call('POST', '/api/supplier-rfqs', rfqBody);
  check(
    r1.status === 200 && r1.json.code === `RFQ-${year}-0001` && r1.json.status === 'DRAFT',
    'RFQ #1 mã 0001 DRAFT',
    r1.json,
  );
  check(
    r1.json.items?.length === 2 && r1.json.items[1].quantity === '500.5' && r1.json.hasImage === false,
    'RFQ #1 items/hasImage',
    r1.json,
  );
  const par = await Promise.all(
    [1, 2, 3].map((i) => call('POST', '/api/supplier-rfqs', { title: `Song song ${i}` })),
  );
  const codes = par.map((p) => p.json?.code as string);
  check(
    par.every((p) => p.status === 200) && new Set(codes).size === 3,
    'tạo 3 RFQ song song: mã không trùng',
    codes,
  );
  check(
    [...codes].sort().join() === [`RFQ-${year}-0002`, `RFQ-${year}-0003`, `RFQ-${year}-0004`].join(),
    'mã liên tục 0002..0004',
    codes,
  );
  check(
    (await call('POST', '/api/supplier-rfqs', { title: ' ' })).status === 400,
    'RFQ thiếu tiêu đề -> 400',
  );
  const rfqId: string = r1.json.id;
  const items: Array<{ id: string }> = r1.json.items;

  const put = await call('PUT', `/api/supplier-rfqs/${par[0].json.id}/items`, {
    items: [{ product: 'Ổi', unit: 'kg' }, { product: 'Mận' }],
  });
  check(
    put.status === 200 && put.json.items.map((i: { no: number }) => i.no).join() === '1,2',
    'PUT items đánh số 1..n',
    put.json,
  );
  check(
    (await call('PATCH', `/api/supplier-rfqs/${rfqId}`, { title: 'Xoài cát Hoà Lộc (sửa)' })).json?.title ===
      'Xoài cát Hoà Lộc (sửa)',
    'PATCH RFQ',
  );

  check(
    (await call('GET', `/api/supplier-rfqs/${rfqId}/image`, undefined, { actor: false })).status === 404,
    'ảnh chưa có -> 404',
  );
  const im = await call('POST', `/api/supplier-rfqs/${rfqId}/image`, undefined, { raw: PNG });
  check(im.status === 200 && im.json.hasImage === true, 'upload ảnh PNG', im.json);
  const gi = await fetch(`${BASE}/api/supplier-rfqs/${rfqId}/image`);
  check(
    gi.status === 200 &&
      gi.headers.get('content-type') === 'image/png' &&
      (await gi.arrayBuffer()).byteLength === PNG.length,
    'GET ảnh công khai (không header actor)',
  );
  const bad = await call('POST', `/api/supplier-rfqs/${rfqId}/image`, undefined, {
    raw: Buffer.from('<svg onload=alert(1)/>'),
    contentType: 'image/svg+xml',
  });
  check(bad.status === 400, 'SVG bị từ chối', bad.json);

  const lr = await call('GET', '/api/supplier-rfqs?status=DRAFT&search=xoài');
  check(
    lr.status === 200 &&
      lr.json.length === 1 &&
      lr.json[0].itemCount === 2 &&
      lr.json[0].invitationCount === 0,
    'danh sách RFQ + lọc',
    lr.json,
  );

  // ===== Gửi =====
  step('Gửi cho NCC (Zalo giả)');
  const s1 = await call('POST', `/api/supplier-rfqs/${rfqId}/send`, { supplierIds: [A.id, B.id, N.id] });
  const res1: Array<Record<string, unknown>> = s1.json?.results ?? [];
  check(s1.status === 200 && res1.length === 3, 'send trả 3 kết quả', s1.json);
  check(
    res1[0]?.ok === true && res1[0]?.status === 'SENT' && !!res1[0]?.invitationId,
    'Alpha gửi được (qua text)',
    res1[0],
  );
  check(res1[1]?.ok === true && res1[1]?.status === 'SENT', 'Beta gửi được (list)', res1[1]);
  check(
    res1[2]?.ok === false && String(res1[2]?.error).includes('chưa Quan tâm OA') && !res1[2]?.invitationId,
    'NCC chỉ có SĐT lạ: lỗi thân thiện, không tạo lời mời',
    res1[2],
  );
  const toA = zaloCalls.filter((c) => c.userId === A.zaloUserId);
  const toB = zaloCalls.filter((c) => c.userId === B.zaloUserId);
  check(
    toA.map((c) => c.kind).join() === 'buttons,text',
    'Alpha: list bị từ chối rồi lùi sang text',
    toA.map((c) => c.kind),
  );
  check(
    toB.map((c) => c.kind).join() === 'buttons',
    'Beta: list một lần',
    toB.map((c) => c.kind),
  );
  check(
    zaloCalls.every((c) => c.token === 'fake-token' && c.path === '/v3.0/oa/message/cs'),
    'mọi cuộc gọi vào Zalo giả đúng token/đường dẫn',
  );
  const listBody = JSON.stringify(toB[0]?.body);
  check(
    listBody.includes('"oa.open.url"') &&
      listBody.includes('"title":"Nhập giá"') &&
      !listBody.includes('Bấm vào link'),
    'tin có nút Nhập giá (không link thô trong chữ)',
    listBody,
  );
  const imgToB = imageCalls.filter((c) => c.userId === B.zaloUserId);
  check(
    imgToB.length === 1 &&
      JSON.stringify(imgToB[0].body).includes('http://app.test/api/supplier-rfqs/' + rfqId + '/image'),
    'tin ảnh riêng gửi trước, URL ảnh theo APP_BASE_URL',
    imgToB.length,
  );
  const orderA = callOrder
    .filter((c) => c.userId === A.zaloUserId)
    .map((c) => c.kind)
    .join();
  check(
    orderA === 'image,buttons,text',
    'Alpha: ảnh -> nút (bị từ chối -1) -> rơi về text đúng 1 lần',
    orderA,
  );
  const tokenB = /http:\/\/app\.test\/ncc\/([A-Za-z0-9_-]{43})/.exec(listBody)?.[1] as string;
  const textBody = (toA[1]?.body as { message: { text: string } }).message.text;
  const tokenA = /http:\/\/app\.test\/ncc\/([A-Za-z0-9_-]{43})/.exec(textBody)?.[1] as string;
  check(!!tokenA && !!tokenB && tokenA !== tokenB, 'mỗi NCC một token riêng', [tokenA, tokenB]);
  check(textBody.includes('RFQ-') && textBody.includes('Hạn báo giá'), 'tin text có mã và hạn', textBody);

  const callsBefore = zaloCalls.length;
  const s2 = await call('POST', `/api/supplier-rfqs/${rfqId}/send`, { supplierIds: [A.id, B.id] });
  check(
    s2.json.results.every(
      (r: { ok: boolean; status: string; error?: string }) =>
        r.ok && r.status === 'SENT' && r.error === 'Đã gửi trước đó.',
    ),
    'gửi lại không resend -> bỏ qua "Đã gửi trước đó."',
    s2.json,
  );
  check(zaloCalls.length === callsBefore, 'bỏ qua thì không gọi Zalo thêm');
  const detail1 = await call('GET', `/api/supplier-rfqs/${rfqId}`);
  check(
    detail1.json.status === 'SENT' && detail1.json.invitations.length === 2,
    'RFQ DRAFT -> SENT, có 2 lời mời',
    detail1.json,
  );
  check(
    (await call('PUT', `/api/supplier-rfqs/${rfqId}/items`, { items: [{ product: 'x' }] })).status === 400,
    'sửa items khi đã SENT -> 400',
  );
  check(
    (await call('DELETE', `/api/supplier-rfqs/${rfqId}`)).status === 400,
    'xoá RFQ không phải DRAFT -> 400',
  );
  check((await call('DELETE', `/api/suppliers/${A.id}`)).status === 400, 'xoá NCC đã có lời mời -> 400');
  check((await call('DELETE', `/api/suppliers/${N.id}`)).json?.ok === true, 'xoá NCC chưa có lời mời');

  // ===== Nhắn thử =====
  step('Thiếu APP_BASE_URL: từ chối, không gọi Zalo');
  const zc0 = zaloCalls.length;
  const nb = await call(
    'POST',
    `/api/supplier-rfqs/${rfqId}/send`,
    { supplierIds: [B.id], resend: true },
    { base: BASE2 },
  );
  check(
    nb.status === 400 &&
      nb.json?.error === 'Chưa cấu hình APP_BASE_URL (domain FE) — không thể tạo link báo giá.',
    'send thiếu APP_BASE_URL -> 400',
    nb.json,
  );
  const nb2 = await call(
    'POST',
    `/api/supplier-rfqs/${rfqId}/test-send`,
    { zaloUserId: '333' },
    { base: BASE2, headers: { 'x-forwarded-host': 'evil.test' } },
  );
  check(
    nb2.status === 400 && String(nb2.json?.error).includes('APP_BASE_URL'),
    'test-send thiếu APP_BASE_URL (dù có header Host giả) -> 400',
    nb2.json,
  );
  check(zaloCalls.length === zc0, 'không có cuộc gọi Zalo nào');

  step('Nhắn thử + người nhận thử');
  await q(
    `insert into users(username,email,password_hash,full_name,is_active) values
     ('nv1','nv1@x.test','x','Nhân viên Một',true), ('nv2','nv2@x.test','x',null,true),
     ('nv3','nv3@x.test','x','Đã khoá',false), ('nv4','nv4@x.test','x','Huỷ liên kết',true)`,
  );
  const bindings = [
    ['nv1', '333', 'ACTIVE'],
    ['nv2', '444', 'ACTIVE'],
    ['nv3', '555', 'ACTIVE'], // user đã khoá -> không được liệt kê
    ['nv4', '666', 'INACTIVE'], // liên kết đã huỷ -> không được liệt kê
  ];
  for (const [u, zid, st] of bindings) {
    await q(
      `insert into zalo_user_bindings(user_id,zalo_user_id,status) select id,$2,$3 from users where username=$1`,
      [u, zid, st],
    );
  }
  const rec = await call('GET', '/api/supplier-rfqs/test-recipients');
  const recNames = (rec.json as Array<{ name: string; zaloUserId: string }>)
    .map((x) => `${x.name}:${x.zaloUserId}`)
    .sort();
  check(
    rec.status === 200 && recNames.join() === ['Nhân viên Một:333', 'nv2:444'].sort().join(),
    'test-recipients: chỉ ACTIVE + user đang bật, tên fallback username',
    recNames,
  );
  const ts = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '333' });
  check(
    ts.status === 200 &&
      ts.json.ok === true &&
      ts.json.mode === 'buttons' &&
      ts.json.imageSent === true &&
      ts.json.zalo?.error === 0,
    'test-send ok (buttons + ảnh) kèm phản hồi Zalo',
    ts.json,
  );
  const testToken = tokenOf(ts.json.link as string);
  check(
    /^http:\/\/app\.test\/ncc\/[A-Za-z0-9_-]{43}$/.test(ts.json.link),
    'test-send trả link',
    ts.json.link,
  );
  check(zaloCalls.at(-1)?.userId === '333', 'tin thử chỉ tới user_id đã chọn');
  const tsFail = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '000' });
  check(
    tsFail.status === 200 && tsFail.json.ok === false && String(tsFail.json.error).includes('error -232'),
    'test-send lỗi: ok=false + error + zalo thô',
    tsFail.json,
  );
  check(
    (await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, {})).status === 400,
    'test-send thiếu zaloUserId -> 400',
  );

  // ===== Công khai =====
  step('Link công khai: xem, nộp giá 2 lần, so sánh');
  const g1 = await call('GET', `/api/public/supplier-rfq/${tokenB}`, undefined, { actor: false });
  check(
    g1.status === 200 &&
      g1.json.supplierName === 'NCC Beta' &&
      g1.json.canSubmit === true &&
      g1.json.expired === false &&
      g1.json.quote === null,
    'GET public hợp lệ',
    g1.json,
  );
  check(
    g1.json.rfq?.hasImage === true &&
      String(g1.json.rfq?.imageUrl).startsWith('/api/supplier-rfqs/') &&
      g1.json.items.length === 2,
    'public: ảnh + 2 mặt hàng',
    g1.json,
  );
  const gtxt = g1.text;
  check(
    !gtxt.includes('NCC Alpha') &&
      !gtxt.includes('tokenHash') &&
      !gtxt.includes('token_hash') &&
      !gtxt.includes('createdBy'),
    'public không lộ NCC khác / hash',
  );
  let inv = (
    await q<{ status: string; viewed_at: Date | null }>(
      `select status, viewed_at from supplier_rfq_invitations where supplier_id=$1`,
      [B.id],
    )
  )[0];
  check(inv.status === 'VIEWED' && inv.viewed_at !== null, 'DB: SENT -> VIEWED + viewed_at', inv);
  const viewedAt = inv.viewed_at?.getTime();
  await call('GET', `/api/public/supplier-rfq/${tokenB}`, undefined, { actor: false });
  inv = (
    await q<{ status: string; viewed_at: Date | null }>(
      `select status, viewed_at from supplier_rfq_invitations where supplier_id=$1`,
      [B.id],
    )
  )[0];
  check(inv.viewed_at?.getTime() === viewedAt, 'viewed_at chỉ ghi một lần');

  const quoteUrl = (t: string) => `/api/public/supplier-rfq/${t}/quote`;
  const q1 = await call(
    'POST',
    quoteUrl(tokenB),
    {
      currency: 'VND',
      validUntil: '2026-12-31',
      note: 'v1',
      items: [
        { rfqItemId: items[0].id, unitPrice: '60000', moq: '100', leadTimeDays: 3 },
        { rfqItemId: items[1].id, unitPrice: 45000 },
      ],
    },
    { actor: false },
  );
  check(q1.status === 200 && q1.json.ok === true && q1.json.version === 1, 'Beta nộp giá v1', q1.json);
  const q2 = await call(
    'POST',
    quoteUrl(tokenB),
    {
      items: [
        { rfqItemId: items[0].id, unitPrice: '55000.5', moq: 50, leadTimeDays: 2, note: 'giá mới' },
        { rfqItemId: items[1].id, unitPrice: '47000' },
      ],
      note: 'v2',
    },
    { actor: false },
  );
  check(q2.status === 200 && q2.json.version === 2, 'Beta nộp giá lần 2 -> version 2', q2.json);
  const qa = await call(
    'POST',
    quoteUrl(tokenA),
    { items: [{ rfqItemId: items[0].id, unitPrice: '58000' }, { rfqItemId: items[1].id }] },
    { actor: false },
  );
  check(qa.status === 200 && qa.json.version === 1, 'Alpha nộp giá v1 (bỏ trống mặt hàng 2)', qa.json);
  const g2 = await call('GET', `/api/public/supplier-rfq/${tokenB}`, undefined, { actor: false });
  check(
    g2.json.quote?.version === 2 &&
      g2.json.quote.items.length === 2 &&
      g2.json.quote.items[0].unitPrice === '55000.5',
    'GET lại thấy báo giá mới nhất để điền sẵn',
    g2.json.quote,
  );
  const stAfterView = (
    await q<{ status: string }>(`select status from supplier_rfq_invitations where supplier_id=$1`, [B.id])
  )[0].status;
  check(stAfterView === 'SUBMITTED', 'GET sau khi nộp không hạ SUBMITTED về VIEWED', stAfterView);
  check(
    (
      await call(
        'POST',
        quoteUrl(tokenB),
        { items: [{ rfqItemId: items[0].id, unitPrice: '0' }] },
        { actor: false },
      )
    ).status === 400,
    'đơn giá 0 -> 400',
  );
  const cur = await call(
    'POST',
    quoteUrl(tokenB),
    { currency: 'USD', items: [{ rfqItemId: items[0].id, unitPrice: 5 }] },
    { actor: false },
  );
  check(
    cur.status === 400 && cur.json?.error === 'Tiền tệ phải là VND.',
    'tiền tệ khác RFQ -> 400 đúng câu',
    cur.json,
  );
  const big = await call(
    'POST',
    quoteUrl(tokenB),
    { items: [{ rfqItemId: items[0].id, unitPrice: 5 }], note: 'x'.repeat(70_000) },
    { actor: false },
  );
  check(big.status === 413 && typeof big.json?.error === 'string', 'body > 64kb -> 413 JSON {error}', [
    big.status,
    big.text.slice(0, 100),
  ]);
  const big2 = await call('POST', '/api/suppliers', { name: 'x'.repeat(70_000) });
  check(big2.status === 400, 'route nội bộ vẫn nhận body lớn rồi validate -> 400', big2.status);

  check(
    (
      await call(
        'POST',
        quoteUrl(tokenB),
        { items: [{ rfqItemId: items[0].id, unitPrice: -1 }] },
        { actor: false },
      )
    ).status === 400,
    'giá âm -> 400',
  );
  check(
    (
      await call(
        'POST',
        quoteUrl(tokenB),
        { items: [{ rfqItemId: items[0].id, unitPrice: '1.23456' }] },
        { actor: false },
      )
    ).status === 400,
    '5 số lẻ -> 400',
  );
  check(
    (
      await call(
        'POST',
        quoteUrl(tokenB),
        { items: [{ rfqItemId: '99999999', unitPrice: 1 }] },
        { actor: false },
      )
    ).status === 400,
    'mặt hàng của RFQ khác -> 400',
  );
  check(
    (await call('POST', quoteUrl(tokenB), { items: [{ rfqItemId: items[0].id }] }, { actor: false }))
      .status === 400,
    'không có giá nào -> 400',
  );
  check(
    (
      await call(
        'POST',
        quoteUrl(tokenB),
        { items: [{ rfqItemId: items[0].id, unitPrice: 1, leadTimeDays: 5000 }] },
        { actor: false },
      )
    ).status === 400,
    'leadTimeDays 5000 -> 400',
  );

  // Link thử: mở và nộp được nhưng không vào so sánh, không có outbox.
  const gt = await call('GET', `/api/public/supplier-rfq/${testToken}`, undefined, { actor: false });
  check(gt.json.isTest === true && gt.json.canSubmit === true, 'link thử: isTest=true', gt.json);
  const qt = await call(
    'POST',
    quoteUrl(testToken),
    { items: [{ rfqItemId: items[0].id, unitPrice: '1' }] },
    { actor: false },
  );
  check(qt.status === 200 && qt.json.version === 1, 'link thử nộp được', qt.json);

  const cmp = await call('GET', `/api/supplier-rfqs/${rfqId}/compare`);
  check(
    cmp.status === 200 && cmp.json.suppliers.length === 2 && cmp.json.rows.length === 2,
    'compare: 2 NCC thật (loại lời mời thử), 2 hàng',
    cmp.json,
  );
  const cA = cmp.json.suppliers.find((s: { name: string }) => s.name === 'NCC Alpha');
  const cB = cmp.json.suppliers.find((s: { name: string }) => s.name === 'NCC Beta');
  check(cB?.version === 2 && cB.note === 'v2' && cA?.version === 1, 'compare dùng phiên bản mới nhất', [
    cA,
    cB,
  ]);
  const row1 = cmp.json.rows[0];
  const idxB = cmp.json.suppliers.findIndex((s: { name: string }) => s.name === 'NCC Beta');
  check(
    row1.prices[idxB]?.unitPrice === '55000.5' &&
      row1.prices[idxB]?.moq === '50' &&
      row1.prices[idxB]?.leadTimeDays === 2,
    'compare: giá v2 của Beta',
    row1.prices,
  );
  check(row1.bestInvitationId === cB.invitationId, 'hàng 1: Beta (55000.5) rẻ hơn Alpha (58000)', row1);
  check(
    cmp.json.rows[1].bestInvitationId === cB.invitationId &&
      cmp.json.rows[1].prices[cmp.json.suppliers.indexOf(cA)] === null,
    'hàng 2: chỉ Beta có giá, Alpha null',
    cmp.json.rows[1],
  );
  check(
    row1.quantity === '1000' && cmp.json.rfq.code === `RFQ-${year}-0001`,
    'compare: quantity + rfq',
    cmp.json.rfq,
  );

  step('DB: outbox, token, nhật ký');
  const ob = await q<{
    event_type: string;
    event_version: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_code: string;
    status: string;
    payload: { version: number; items: unknown[]; rfqCode: string; invitationId: string };
  }>(
    `select event_type,event_version,aggregate_type,aggregate_id,aggregate_code,status,payload from outbox_events order by sequence_no`,
  );
  check(ob.length === 3, 'outbox: đúng 3 sự kiện (Beta v1, v2, Alpha v1; link thử không phát)', ob.length);
  check(
    ob.every(
      (e) =>
        e.event_type === 'supplier_quote.submitted' &&
        e.event_version === 'v1' &&
        e.aggregate_type === 'SupplierRfq' &&
        e.aggregate_id === rfqId &&
        e.aggregate_code === `RFQ-${year}-0001` &&
        e.status === 'PENDING',
    ),
    'outbox: các cột đúng',
    ob[0],
  );
  check(
    ob[1].payload.version === 2 &&
      ob[1].payload.items.length === 2 &&
      ob[0].payload.rfqCode === `RFQ-${year}-0001`,
    'outbox: payload',
    ob[1].payload,
  );
  const hashes = await q<{ token_hash: string }>(`select token_hash from supplier_rfq_invitations`);
  check(
    hashes.length === 4 &&
      hashes.every((h) => /^[0-9a-f]{64}$/.test(h.token_hash)) &&
      ![tokenA, tokenB, testToken].some((t) => hashes.some((h) => h.token_hash.includes(t))),
    'DB chỉ lưu sha256 hex của token',
    hashes.length,
  );
  const quotes = await q<{ cnt: string }>(`select count(*)::text as cnt from supplier_quotes`);
  check(quotes[0].cnt === '4', 'DB: 4 quote (Beta v1,v2, Alpha v1, thử v1)', quotes);
  const invs = await q<{ status: string; submitted_at: Date | null; is_test: boolean }>(
    `select status, submitted_at, is_test from supplier_rfq_invitations order by id`,
  );
  check(
    invs.filter((i) => i.status === 'SUBMITTED' && i.submitted_at !== null).length === 3 &&
      invs.filter((i) => i.status === 'FAILED').length === 1,
    'DB: 3 lời mời SUBMITTED + 1 lời mời thử FAILED',
    invs,
  );
  const act = await q<{ cnt: string }>(
    `select count(*)::text as cnt from activity_logs where action='NCC_NOP_GIA'`,
  );
  check(act[0].cnt === '4', 'nhật ký NCC_NOP_GIA', act);
  check(
    Number(
      (
        await q<{ c: string }>(
          `select count(*)::text as c from activity_logs where action in ('RFQ_TAO','RFQ_GUI','RFQ_NHAN_THU','NCC_TAO')`,
        )
      )[0].c,
    ) >= 6,
    'nhật ký thao tác nội bộ',
  );

  step('Gửi theo SĐT (tra user_id qua Zalo giả)');
  const P = (await call('POST', '/api/suppliers', { name: 'NCC Phone', phone: '0900 000 001' })).json;
  const U = (await call('POST', '/api/suppliers', { name: 'NCC SĐT lạ', phone: '0900000077' })).json;
  const E = (await call('POST', '/api/suppliers', { name: 'NCC Trống' })).json;
  const rq = (
    await call('POST', '/api/supplier-rfqs', { title: 'Gửi theo SĐT', items: [{ product: 'Dừa' }] })
  ).json;
  const zc1 = zaloCalls.length;
  const sp1 = await call('POST', `/api/supplier-rfqs/${rq.id}/send`, { supplierIds: [P.id, U.id, E.id] });
  const rr: Array<Record<string, unknown>> = sp1.json?.results ?? [];
  check(rr[0]?.ok === true && rr[0]?.status === 'SENT', 'NCC chỉ có SĐT: gửi được', rr[0]);
  check(
    zaloCalls.length === zc1 + 1 && zaloCalls.at(-1)?.userId === RESOLVED_ID,
    'tin gửi tới user_id đã tra từ SĐT',
    zaloCalls.at(-1)?.userId,
  );
  check(
    detailCalls.some((d) => d.phone === KNOWN_PHONE && d.token === 'fake-token'),
    'đã gọi user/detail với SĐT chuẩn hoá 84...',
    detailCalls,
  );
  const pz = (
    await q<{ zalo_user_id: string | null }>(`select zalo_user_id from suppliers where id=$1`, [P.id])
  )[0].zalo_user_id;
  check(pz === RESOLVED_ID, 'user_id tra được đã lưu vào NCC', pz);
  check(
    rr[1]?.ok === false && String(rr[1]?.error).includes('chưa Quan tâm OA'),
    'SĐT lạ -> lỗi thân thiện',
    rr[1],
  );
  check(
    rr[2]?.ok === false && rr[2]?.error === 'Nhà cung cấp chưa có SĐT hoặc Zalo user_id.',
    'NCC không SĐT/ID -> đúng câu',
    rr[2],
  );
  const stuck = await q<{ c: string }>(
    `select count(*)::text as c from supplier_rfq_invitations where supplier_id in ($1,$2)`,
    [U.id, E.id],
  );
  check(stuck[0].c === '0', 'tra lỗi / thiếu thông tin: không để lại lời mời treo', stuck);
  const sp2 = await call('POST', `/api/supplier-rfqs/${rq.id}/send`, { supplierIds: [P.id] });
  check(
    sp2.json.results[0].error === 'Đã gửi trước đó.' && zaloCalls.length === zc1 + 1,
    'gửi lại NCC đã gửi: bỏ qua, không tra/gửi thêm',
  );

  const tz0 = zaloCalls.length;
  const tp = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '0900 000.001' });
  check(
    tp.status === 200 && tp.json.ok === true && tp.json.resolvedUserId === RESOLVED_ID,
    'test-send bằng SĐT: resolvedUserId',
    tp.json,
  );
  check(
    zaloCalls.length === tz0 + 1 && zaloCalls.at(-1)?.userId === RESOLVED_ID,
    'test-send gửi tới id đã tra',
  );
  const tpUnknown = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '0900000099' });
  check(
    tpUnknown.status === 200 &&
      tpUnknown.json.ok === false &&
      String(tpUnknown.json.error).includes('chưa Quan tâm OA'),
    'test-send SĐT lạ: ok=false HTTP 200 + lỗi thân thiện',
    tpUnknown.json,
  );
  check(zaloCalls.length === tz0 + 1, 'SĐT lạ: không gửi gì');
  check(
    !(
      'resolvedUserId' in
      (await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '333333' })).json
    ),
    'test-send bằng user_id: không có resolvedUserId',
  );

  step('Tin ảnh + nút: ảnh lỗi, nút lỗi, -230');
  failImageUsers.add('333');
  const zi0 = zaloCalls.length;
  const tImg = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '333' });
  failImageUsers.delete('333');
  check(
    tImg.json.ok === true &&
      tImg.json.mode === 'buttons' &&
      tImg.json.imageSent === false &&
      typeof tImg.json.imageError === 'string',
    'ảnh bị từ chối: vẫn gửi tin báo giá, ghi imageError',
    tImg.json,
  );
  check(
    zaloCalls.length === zi0 + 1 && zaloCalls.at(-1)?.kind === 'buttons',
    'tin có nút vẫn tới nơi dù ảnh lỗi',
  );

  buttonsFailCode = -1;
  const zb0 = zaloCalls.length;
  const tFall = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '333' });
  check(
    tFall.json.ok === true &&
      tFall.json.mode === 'text' &&
      String(tFall.json.buttonError).includes('Invalid button') &&
      !('listError' in tFall.json),
    'nút bị từ chối (lỗi nghiệp vụ): rơi về text, trả buttonError',
    tFall.json,
  );
  check(zaloCalls.length === zb0 + 2 && zaloCalls.at(-1)?.kind === 'text', 'rơi về text đúng 1 lần');

  buttonsFailCode = -230;
  const zn0 = zaloCalls.length;
  const t230 = await call('POST', `/api/supplier-rfqs/${rfqId}/test-send`, { zaloUserId: '333' });
  check(
    t230.status === 200 &&
      t230.json.ok === false &&
      t230.json.mode === 'buttons' &&
      t230.json.error ===
        'Người nhận không tương tác với OA quá 7 ngày — nhờ họ nhắn OA một tin rồi gửi lại.' &&
      t230.json.zalo?.error === -230,
    '-230: không rơi về text, lỗi thân thiện + zalo thô',
    t230.json,
  );
  check(zaloCalls.length === zn0 + 1, '-230: chỉ 1 cuộc gọi tin (không gửi text)');

  // ===== Resend =====
  step('Gửi lại có resend');
  const before = zaloCalls.length;
  const hashBefore = (
    await q<{ token_hash: string }>(`select token_hash from supplier_rfq_invitations where supplier_id=$1`, [
      B.id,
    ])
  )[0].token_hash;
  const rs = await call('POST', `/api/supplier-rfqs/${rfqId}/send`, { supplierIds: [B.id], resend: true });
  check(
    rs.json.results[0].ok === true &&
      rs.json.results[0].status === 'SUBMITTED' &&
      zaloCalls.length === before + 1,
    'resend: gọi Zalo, giữ SUBMITTED',
    rs.json,
  );
  const hashAfter = (
    await q<{ token_hash: string }>(`select token_hash from supplier_rfq_invitations where supplier_id=$1`, [
      B.id,
    ])
  )[0].token_hash;
  check(hashBefore !== hashAfter, 'resend: token mới');
  check(
    (await call('GET', `/api/public/supplier-rfq/${tokenB}`, undefined, { actor: false })).status === 404,
    'resend: link cũ vô hiệu',
  );
  const linkRe = new RegExp('http://app[.]test/ncc/([A-Za-z0-9_-]{43})');
  const tokenB2 = linkRe.exec(JSON.stringify(zaloCalls.at(-1)?.body))?.[1] as string;
  check(
    (await call('GET', `/api/public/supplier-rfq/${tokenB2}`, undefined, { actor: false })).status === 200,
    'resend: link MỚI trong tin dùng được (hash đã lưu trước khi gửi)',
  );

  step('Resend: bấm đúp và gửi lỗi');
  const hashOf = async () =>
    (
      await q<{ token_hash: string }>(
        `select token_hash from supplier_rfq_invitations where supplier_id=$1`,
        [B.id],
      )
    )[0].token_hash;
  delayUsers.add(B.zaloUserId);
  const h0 = await hashOf();
  const c0 = zaloCalls.length;
  const evilHeaders = { 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' };
  const dbl = await Promise.all(
    [1, 2, 3].map(() =>
      call(
        'POST',
        `/api/supplier-rfqs/${rfqId}/send`,
        { supplierIds: [B.id], resend: true },
        { headers: evilHeaders },
      ),
    ),
  );
  delayUsers.delete(B.zaloUserId);
  const dblRes = dbl.map((d) => d.json.results[0] as { ok: boolean; error?: string });
  check(
    dblRes.filter((r) => r.ok).length === 1 &&
      dblRes.filter((r) => r.error === 'Đang gửi cho nhà cung cấp này, vui lòng chờ.').length === 2,
    'bấm đúp: 1 lượt chạy, 2 lượt bị chặn',
    dblRes,
  );
  check(zaloCalls.length === c0 + 1, 'bấm đúp: đúng 1 tin tới Zalo', zaloCalls.length - c0);
  const h1 = await hashOf();
  check(h1 !== h0, 'bấm đúp: token đổi đúng một lần');
  const newLinkJson = JSON.stringify(zaloCalls.at(-1)?.body);
  check(
    newLinkJson.includes('http://app.test/ncc/') && !newLinkJson.includes('evil.test'),
    'link luôn theo APP_BASE_URL, không theo header giả',
  );
  const tokenB3 = linkRe.exec(newLinkJson)?.[1] as string;
  check(
    (await call('GET', `/api/public/supplier-rfq/${tokenB3}`, undefined, { actor: false })).status === 200,
    'bấm đúp: link trong tin dùng được',
  );

  failUsers.add(B.zaloUserId);
  const rf = await call('POST', `/api/supplier-rfqs/${rfqId}/send`, { supplierIds: [B.id], resend: true });
  failUsers.delete(B.zaloUserId);
  check(
    rf.json.results[0].ok === false && rf.json.results[0].status === 'SUBMITTED',
    'resend lỗi: ok=false, giữ SUBMITTED',
    rf.json,
  );
  check((await hashOf()) === h1, 'resend lỗi: hash cũ được giữ');
  check(
    (await call('GET', `/api/public/supplier-rfq/${tokenB3}`, undefined, { actor: false })).status === 200,
    'resend lỗi: link cũ vẫn dùng được',
  );

  // ===== Token sai / hết hạn / quá hạn =====
  step('Token sai, hết hạn, quá hạn');
  const unknown = await call('GET', `/api/public/supplier-rfq/${'x'.repeat(43)}`, undefined, {
    actor: false,
  });
  check(
    unknown.status === 404 && unknown.json?.error === 'Link không hợp lệ hoặc đã hết hạn.',
    'token lạ -> 404 đúng câu',
    unknown.json,
  );
  await q(`update supplier_rfq_invitations set expires_at = now() - interval '1 day' where supplier_id=$1`, [
    A.id,
  ]);
  const exp = await call('GET', `/api/public/supplier-rfq/${tokenA}`, undefined, { actor: false });
  check(
    exp.status === 404 && exp.json?.error === 'Link không hợp lệ hoặc đã hết hạn.',
    'link hết hạn -> 404',
    exp.json,
  );
  check(
    (
      await call(
        'POST',
        quoteUrl(tokenA),
        { items: [{ rfqItemId: items[0].id, unitPrice: 1 }] },
        { actor: false },
      )
    ).status === 404,
    'nộp bằng link hết hạn -> 404',
  );

  const rp = await call('POST', '/api/supplier-rfqs', {
    title: 'Sắp hết hạn',
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    items: [{ product: 'Cam' }],
  });
  const sp = await call('POST', `/api/supplier-rfqs/${rp.json.id}/send`, { supplierIds: [B.id] });
  check(sp.json.results[0].ok === true, 'RFQ #2 gửi cho Beta', sp.json);
  const tokenP = /ncc\/([A-Za-z0-9_-]{43})/.exec(JSON.stringify(zaloCalls.at(-1)?.body))?.[1] as string;
  const newDl = new Date(Date.now() + 10 * 86_400_000);
  const pd = await call('PATCH', `/api/supplier-rfqs/${rp.json.id}`, { deadline: newDl.toISOString() });
  check(pd.status === 200, 'PATCH deadline', pd.json);
  const ex = (
    await q<{ expires_at: Date }>(
      `select expires_at from supplier_rfq_invitations where rfq_id=$1 and is_test=false`,
      [rp.json.id],
    )
  )[0].expires_at;
  check(
    Math.abs(ex.getTime() - (newDl.getTime() + 30 * 86_400_000)) < 2000,
    'PATCH deadline dời expires_at = hạn mới + 30 ngày',
    ex,
  );
  await q(`update supplier_rfqs set deadline = now() - interval '1 hour' where id=$1`, [rp.json.id]);
  const gp = await call('GET', `/api/public/supplier-rfq/${tokenP}`, undefined, { actor: false });
  check(
    gp.status === 200 && gp.json.expired === true && gp.json.canSubmit === false,
    'quá hạn: expired=true canSubmit=false',
    gp.json,
  );
  const pp = await call(
    'POST',
    quoteUrl(tokenP),
    { items: [{ rfqItemId: rp.json.items[0].id, unitPrice: 1 }] },
    { actor: false },
  );
  check(
    pp.status === 400 && pp.json?.error === 'Đã quá hạn báo giá.',
    'quá hạn nộp -> 400 đúng câu',
    pp.json,
  );

  // ===== Đóng =====
  step('Đóng RFQ');
  const cl = await call('POST', `/api/supplier-rfqs/${rfqId}/close`);
  check(cl.status === 200 && cl.json.status === 'CLOSED', 'close -> CLOSED', cl.json);
  const gtc = await call('GET', `/api/public/supplier-rfq/${testToken}`, undefined, { actor: false });
  check(gtc.json.canSubmit === false, 'sau khi đóng: canSubmit=false', gtc.json);
  check(
    (
      await call(
        'POST',
        quoteUrl(testToken),
        { items: [{ rfqItemId: items[0].id, unitPrice: 1 }] },
        { actor: false },
      )
    ).status === 400,
    'sau khi đóng nộp -> 400',
  );
  check(
    (await call('POST', `/api/supplier-rfqs/${rfqId}/send`, { supplierIds: [B.id] })).status === 400,
    'đóng rồi không gửi được',
  );
  check(
    (await call('PATCH', `/api/supplier-rfqs/${rfqId}`, { title: 'x' })).status === 400,
    'đóng rồi không sửa được',
  );
  const delDraft = await call('DELETE', `/api/supplier-rfqs/${par[1].json.id}`);
  check(delDraft.status === 200 && delDraft.json.ok === true, 'xoá RFQ DRAFT');
  check((await call('GET', `/api/supplier-rfqs/${par[1].json.id}`)).status === 404, 'RFQ đã xoá -> 404');

  // ===== Rate limit =====
  step('Giới hạn tần suất');
  const rl = 'r'.repeat(43);
  const codesRl: number[] = [];
  for (let i = 0; i < 33; i++)
    codesRl.push(
      (await call('GET', `/api/public/supplier-rfq/${rl}`, undefined, { actor: false, ip: '10.1.1.1' }))
        .status,
    );
  check(
    codesRl.slice(0, 30).every((c) => c === 404) && codesRl.slice(30).every((c) => c === 429),
    '30 lượt đầu 404, từ lượt 31 -> 429',
    codesRl,
  );
  const r429 = await call('GET', `/api/public/supplier-rfq/${rl}`, undefined, {
    actor: false,
    ip: '10.1.1.1',
  });
  check(r429.json?.error === 'Thao tác quá nhanh, thử lại sau.', '429 đúng câu', r429.json);
  // Quét token ngẫu nhiên từ MỘT IP: nấc theo IP chặn từ lượt 121.
  const flood: number[] = [];
  for (let i = 0; i < 125; i++) {
    const rnd = Buffer.from(String(i).padStart(2, '0') + 'z'.repeat(60))
      .toString('base64url')
      .slice(0, 43);
    flood.push(
      (await call('GET', `/api/public/supplier-rfq/${rnd}`, undefined, { actor: false, ip: '10.2.2.2' }))
        .status,
    );
  }
  check(
    flood.slice(0, 120).every((c) => c === 404) && flood.slice(120).every((c) => c === 429),
    'quét token ngẫu nhiên: 120 lượt/IP rồi 429',
    flood.filter((c) => c === 429).length,
  );
  check(
    (await call('GET', `/api/public/supplier-rfq/${rl}`, undefined, { actor: false, ip: '10.3.3.3' }))
      .status === 404,
    'IP khác không bị ảnh hưởng',
  );

  step('Nhắn thử: giới hạn 20 lượt/giờ/RFQ');
  const rc = await call('POST', '/api/supplier-rfqs', {
    title: 'Giới hạn nhắn thử',
    items: [{ product: 'Na' }],
  });
  let lastTs = 0;
  for (let i = 0; i < 20; i++)
    lastTs = (await call('POST', `/api/supplier-rfqs/${rc.json.id}/test-send`, { zaloUserId: '333' })).status;
  check(lastTs === 200, '20 lượt nhắn thử đầu thành công', lastTs);
  const over = await call('POST', `/api/supplier-rfqs/${rc.json.id}/test-send`, { zaloUserId: '333' });
  check(
    over.status === 429 && over.json?.error === 'Đã nhắn thử quá nhiều lần, thử lại sau.',
    'lượt 21 -> 429 đúng câu',
    over.json,
  );
  const zcap = zaloCalls.length;
  await call('POST', `/api/supplier-rfqs/${rc.json.id}/test-send`, { zaloUserId: '333' });
  check(zaloCalls.length === zcap, 'bị chặn thì không gọi Zalo');
  check(
    !zaloCalls.some(
      (c) =>
        !['111111111111111111', '222222222222222222', '333', '000', '333333', RESOLVED_ID].includes(c.userId),
    ),
    'Zalo giả chỉ nhận user_id đã chỉ định',
  );
}

main()
  .then(async () => {
    await cleanup();
    if (failures.length) {
      console.error(
        `\nRFQ TEST FAILED: ${failures.length}/${checks} kiểm tra sai:\n - ${failures.join('\n - ')}`,
      );
      process.exit(1);
    }
    console.log(`\nRFQ TEST PASSED: ${checks} kiểm tra.`);
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('\nRFQ TEST ERROR:', e instanceof Error ? e.stack : e);
    await cleanup();
    process.exit(1);
  });
