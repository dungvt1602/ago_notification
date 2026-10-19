import crypto from 'node:crypto';
import type { Db } from './db';
import type { RawResult, StepOrFn, StepSpec, Vars } from './http';
import { seedExpiredZaloToken, seedPkce } from './seed';
import { WA_VERIFY_TOKEN, ZALO_APP_ID, ZALO_WEBHOOK_SECRET } from './config';

export interface Scenario {
  name: string;
  /** Chỉnh thêm DB sau khi seed (chạy cho CẢ HAI phía, trước khi gọi HTTP). */
  setup?: (db: Db) => Promise<void>;
  steps: StepOrFn[];
  /** Đợi sau scenario (ms) — cache hạn mức 30s trong tiến trình. */
  cooldownMs?: number;
  /** Mỗi bước chạy trên DB reset+seed riêng, so sánh DB từng bước (tránh lệch id lan sang bước sau). */
  isolated?: boolean;
}

// ---------- helpers ----------
type Extra = Partial<StepSpec>;
const get = (name: string, path: string, x: Extra = {}): StepSpec => ({ name, method: 'GET', path, ...x });
const del = (name: string, path: string, x: Extra = {}): StepSpec => ({ name, method: 'DELETE', path, ...x });
const post = (name: string, path: string, json?: unknown, x: Extra = {}): StepSpec => ({ name, method: 'POST', path, json, ...x });
const patch = (name: string, path: string, json?: unknown, x: Extra = {}): StepSpec => ({ name, method: 'PATCH', path, json, ...x });
const put = (name: string, path: string, json?: unknown, x: Extra = {}): StepSpec => ({ name, method: 'PUT', path, json, ...x });
const rawJson = (name: string, method: string, path: string, text: string, x: Extra = {}): StepSpec => ({
  name, method, path, text, contentType: 'application/json', ...x,
});
const badJson = (name: string, method: string, path: string, x: Extra = {}): StepSpec => rawJson(name, method, path, '{not json', x);
const emptyBody = (name: string, method: string, path: string, x: Extra = {}): StepSpec => rawJson(name, method, path, '', x);

const j = (r: RawResult) => (r.json ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ---------- 1. health & lặt vặt ----------
const health: Scenario = {
  name: 'health',
  steps: [get('GET health', '/health'), { name: 'HEAD health', method: 'HEAD', path: '/health' }],
};

const misc: Scenario = {
  name: 'hello-unknown-methods',
  steps: [
    get('GET hello', '/hello'),
    post('POST hello', '/hello', { a: 1, b: 'x' }),
    get('GET unknown route', '/does-not-exist'),
    post('POST unknown route', '/does-not-exist', {}),
    del('DELETE health (method mismatch)', '/health'),
    post('POST dashboard (method mismatch)', '/dashboard', {}),
    put('PUT customers/markets (method mismatch)', '/customers/markets', {}),
    del('DELETE quotations list (method mismatch)', '/quotations'),
    get('GET users/1 (no GET handler)', '/users/1'),
    get('GET send/preview (no GET handler)', '/send/preview'),
    get('GET send/process (no GET handler)', '/send/process'),
    { name: 'OPTIONS customers', method: 'OPTIONS', path: '/customers' },
  ],
};

// ---------- 2. auth ----------
const auth: Scenario = {
  name: 'auth-login',
  steps: [
    post('login admin by username', '/auth/login', { identifier: 'admin', password: 'Admin@123' }),
    post('login admin by email (case-insens, spaces)', '/auth/login', { identifier: '  ADMIN@Parity.TEST ', password: 'Admin@123' }),
    post('login sale', '/auth/login', { identifier: 'sale1', password: 'Sale@123' }),
    post('login wrong password', '/auth/login', { identifier: 'admin', password: 'nope' }),
    post('login unknown user', '/auth/login', { identifier: 'ghost', password: 'x' }),
    post('login inactive user', '/auth/login', { identifier: 'locked', password: 'Lock@123' }),
    post('login user without password', '/auth/login', { identifier: 'nopass', password: 'anything' }),
    post('login missing identifier', '/auth/login', { password: 'x' }),
    post('login missing password', '/auth/login', { identifier: 'admin' }),
    post('login empty object', '/auth/login', {}),
    post('login numeric identifier', '/auth/login', { identifier: 123, password: 456 }),
    post('login no actor headers', '/auth/login', { identifier: 'sale1', password: 'bad' }, { noActor: true }),
    get('activity after logins', '/activity'),
  ],
};

// ---------- 3. users ----------
const users: Scenario = {
  name: 'users',
  steps: [
    get('list users', '/users'),
    post('create user with password', '/users', { username: 'newbie', email: 'newbie@parity.test', fullName: 'Người Mới', password: 'Newbie@123' }),
    post('create user no password', '/users', { username: 'nopw2', email: 'nopw2@parity.test' }),
    post('create user inactive + null fullName', '/users', { username: 'off', email: 'off@parity.test', fullName: null, isActive: false }),
    post('create duplicate username', '/users', { username: 'admin', email: 'other@parity.test' }),
    post('create duplicate email', '/users', { username: 'someone', email: 'admin@parity.test' }),
    post('create missing username', '/users', { email: 'x@y.z' }),
    post('create empty username', '/users', { username: '', email: 'x@y.z' }),
    post('create bad types', '/users', { username: 5, email: ['a'] }),
    post('create no actor', '/users', { username: 'anon', email: 'anon@parity.test' }, { noActor: true }),
    post('login new user (hash works)', '/auth/login', { identifier: 'newbie', password: 'Newbie@123' }),
    patch('patch fullName', '/users/2', { fullName: 'Sale Đổi Tên' }),
    patch('patch change password', '/users/2', { password: 'Changed@123' }),
    post('login with changed password', '/auth/login', { identifier: 'sale1', password: 'Changed@123' }),
    post('login with old password', '/auth/login', { identifier: 'sale1', password: 'Sale@123' }),
    patch('patch deactivate', '/users/2', { isActive: false }),
    patch('patch empty object', '/users/1', {}),
    patch('patch duplicate username', '/users/2', { username: 'admin' }),
    patch('patch email only', '/users/4', { email: 'nopass2@parity.test' }),
    patch('patch unknown id', '/users/9999', { fullName: 'x' }),
    patch('patch non-numeric id', '/users/abc', { fullName: 'x' }),
    patch('patch invalid body', '/users/1', { isActive: 'yes' }),
    del('delete user 3', '/users/3'),
    del('delete user with zalo binding+quotation (2)', '/users/2'),
    del('delete unknown', '/users/9999'),
    del('delete non-numeric', '/users/abc'),
    get('list users after', '/users'),
    get('activity after', '/activity'),
  ],
};

const usersZalo: Scenario = {
  name: 'users-zalo',
  steps: [
    get('zalo status user 2 (linked)', '/users/2/zalo'),
    get('zalo status user 1 (not linked)', '/users/1/zalo'),
    get('zalo status user 3 (expired pending)', '/users/3/zalo'),
    get('zalo status unknown user', '/users/9999/zalo'),
    get('zalo status non-numeric', '/users/abc/zalo'),
    post('link-code user 1', '/users/1/zalo/link-code', undefined, { maskKeys: ['code'] }),
    get('zalo status user 1 pending', '/users/1/zalo'),
    post('link-code user 1 again (overwrite)', '/users/1/zalo/link-code', undefined, { maskKeys: ['code'] }),
    post('link-code user 3 (cleans expired)', '/users/3/zalo/link-code', undefined, { maskKeys: ['code'] }),
    post('link-code unknown user', '/users/9999/zalo/link-code'),
    post('link-code non-numeric', '/users/abc/zalo/link-code'),
    del('unlink user 2', '/users/2/zalo'),
    del('unlink user 2 again', '/users/2/zalo'),
    del('unlink user 1 (pending only)', '/users/1/zalo'),
    del('unlink unknown user', '/users/9999/zalo'),
    get('list users (zalo column)', '/users'),
    get('receive channels after', '/receive-channels'),
  ],
};

// ---------- 4. channels ----------
const channels: Scenario = {
  name: 'channels',
  steps: [
    get('list channels', '/channels'),
    post('create channel', '/channels', { name: 'WA 2', type: 'WHATSAPP', accountId: 'PHONEID-2', apiKeyEnv: 'WHATSAPP_TOKEN_2', note: 'ghi chú' }),
    post('create channel inactive null note', '/channels', { name: 'TG 2', type: 'TELEGRAM', accountId: 'BOT-2', apiKeyEnv: 'TG_2', isActive: false, note: null }),
    post('create duplicate (type,account)', '/channels', { name: 'dup', type: 'WHATSAPP', accountId: 'PHONEID-1', apiKeyEnv: 'X' }),
    post('create missing name', '/channels', { type: 'WHATSAPP', accountId: 'a', apiKeyEnv: 'b' }),
    post('create empty strings', '/channels', { name: '', type: '', accountId: '', apiKeyEnv: '' }),
    post('create wrong types', '/channels', { name: 1, type: true, accountId: [], apiKeyEnv: {} }),
    patch('patch name+note', '/channels/2', { name: 'TG Bot đổi', note: 'mới' }),
    patch('patch clear note', '/channels/1', { note: null }),
    patch('patch toggle active', '/channels/3', { isActive: true }),
    patch('patch empty', '/channels/3', {}),
    patch('patch duplicate account', '/channels/2', { type: 'WHATSAPP', accountId: 'PHONEID-1' }),
    patch('patch unknown', '/channels/9999', { name: 'x' }),
    patch('patch non-numeric', '/channels/abc', { name: 'x' }),
    patch('patch invalid type', '/channels/1', { isActive: 'true' }),
    del('delete unused channel 3', '/channels/3'),
    del('delete channel with dependents (1)', '/channels/1'),
    del('delete channel with batches only (2? has template)', '/channels/2'),
    del('delete unknown', '/channels/9999'),
    del('delete non-numeric', '/channels/abc'),
    get('list channels after', '/channels'),
    get('activity', '/activity'),
  ],
};

const receiveChannels: Scenario = {
  name: 'receive-channels',
  steps: [
    get('list receive channels', '/receive-channels'),
    post('create receive channel', '/receive-channels', { name: 'TG nhận 2', type: 'TELEGRAM', accountId: '12345', apiKeyEnv: 'TG_TOKEN', note: 'sếp 2' }),
    post('create receive inactive', '/receive-channels', { name: 'ZL', type: 'ZALO', accountId: 'zuid-x', apiKeyEnv: 'ZALO_OA_TOKEN_MAIN', isActive: false }),
    post('create duplicate', '/receive-channels', { name: 'dup', type: 'WHATSAPP', accountId: 'PHONEID-1', apiKeyEnv: 'X' }),
    post('create missing fields', '/receive-channels', { name: 'only name' }),
    post('create wrong types', '/receive-channels', { name: 1, type: 2, accountId: 3, apiKeyEnv: 4 }),
    patch('patch rename', '/receive-channels/2', { name: 'Sếp TG mới' }),
    patch('patch clear note', '/receive-channels/2', { note: null }),
    patch('patch deactivate', '/receive-channels/3', { isActive: false }),
    patch('patch empty', '/receive-channels/1', {}),
    patch('patch duplicate', '/receive-channels/2', { type: 'WHATSAPP', accountId: 'PHONEID-1' }),
    patch('patch unknown', '/receive-channels/9999', { name: 'x' }),
    patch('patch non-numeric', '/receive-channels/abc', { name: 'x' }),
    patch('patch invalid', '/receive-channels/1', { isActive: 'x' }),
    del('delete 4', '/receive-channels/4'),
    del('delete 1 (has inbound messages -> SetNull)', '/receive-channels/1'),
    del('delete unknown', '/receive-channels/9999'),
    del('delete non-numeric', '/receive-channels/abc'),
    get('list after', '/receive-channels'),
    get('inbound after', '/inbound'),
  ],
};

// ---------- 5. customers ----------
const customersList: Scenario = {
  name: 'customers-list',
  steps: [
    get('list default', '/customers'),
    get('list market=india (insensitive)', '/customers?market=india'),
    get('list market=Vietnam (mixed case rows)', '/customers?market=VIETNAM'),
    get('list market with spaces', '/customers?market=%20uae%20'),
    get('list search=nguyễn', '/customers?search=' + encodeURIComponent('nguyễn')),
    get('list search by phone', '/customers?search=9198760'),
    get('list search by email', '/customers?search=C12@EXAMPLE'),
    get('list sort=company desc', '/customers?sort=company&dir=desc'),
    get('list sort=whatsappPhone asc', '/customers?sort=whatsappPhone&dir=asc'),
    get('list sort=phoneType', '/customers?sort=phoneType'),
    get('list sort=market desc', '/customers?sort=market&dir=desc'),
    get('list sort=status', '/customers?sort=status'),
    get('list sort invalid -> name', '/customers?sort=password&dir=sideways'),
    get('list excludeTemplate=1', '/customers?excludeTemplate=1'),
    get('list excludeTemplate=abc', '/customers?excludeTemplate=abc'),
    get('list excludeTemplate + market + search', '/customers?excludeTemplate=1&market=india&search=acme'),
    get('list duplicate query params (first wins)', '/customers?market=INDIA&market=UAE'),
    get('markets', '/customers/markets'),
  ],
};

const customersSearch: Scenario = {
  name: 'customers-search',
  steps: [
    get('search default', '/customers/search'),
    get('search page=2 limit=7', '/customers/search?page=2&limit=7'),
    get('search limit=500 (clamp)', '/customers/search?limit=500'),
    get('search limit=0 -> default', '/customers/search?limit=0'),
    get('search page=0', '/customers/search?page=0'),
    get('search page=-3&limit=-1', '/customers/search?page=-3&limit=-1'),
    get('search page=abc', '/customers/search?page=abc&limit=xyz'),
    get('search page beyond end', '/customers/search?page=99'),
    get('search market+hasWhatsapp', '/customers/search?market=vietnam&hasWhatsapp=1'),
    get('search hasWhatsapp=0', '/customers/search?hasWhatsapp=0'),
    get('search phoneType=mobile', '/customers/search?phoneType=mobile'),
    get('search phoneType=FIXED_LINE', '/customers/search?phoneType=FIXED_LINE&limit=50'),
    get('search phoneType=UNKNOWN', '/customers/search?phoneType=UNKNOWN'),
    get('search phoneType=AMBIGUOUS', '/customers/search?phoneType=AMBIGUOUS'),
    get('search phoneType blank', '/customers/search?phoneType=%20'),
    get('search text + sort desc', '/customers/search?search=acme&sort=name&dir=desc&limit=5'),
    get('search sort=email', '/customers/search?sort=email&dir=asc&limit=10'),
    get('search sort invalid', '/customers/search?sort=zzz'),
    get('search nothing found', '/customers/search?search=zzzzzz'),
    get('idsOnly', '/customers/search?idsOnly=1'),
    get('idsOnly + market + templateId', '/customers/search?idsOnly=1&market=INDIA&templateId=1'),
    get('idsOnly + templateId=3 + search', '/customers/search?idsOnly=1&templateId=3&search=nguy'),
    get('idsOnly + templateId=abc', '/customers/search?idsOnly=1&templateId=abc'),
    get('idsOnly + no match', '/customers/search?idsOnly=1&search=zzzzzz&templateId=1'),
    get('idsOnly + hasWhatsapp + phoneType', '/customers/search?idsOnly=1&hasWhatsapp=1&phoneType=mobile'),
    get('idsOnly=0 (truthy string)', '/customers/search?idsOnly=0'),
  ],
};

const customersWrite: Scenario = {
  name: 'customers-write',
  steps: [
    post('create ok', '/customers', { name: '  Khách Mới  ', company: 'Cty Mới', whatsappPhone: '84987654321', email: 'moi@example.com', market: 'VIETNAM', note: 'ghi chú' }),
    post('create with phone + templateId', '/customers', { name: 'Có Template', whatsappPhone: '919812345678', phone: '84901234567', market: 'INDIA', templateId: 3 }),
    post('create templateId string', '/customers', { name: 'TplStr', whatsappPhone: '971501111111', market: 'UAE', templateId: '2' }),
    post('create inactive + no receive', '/customers', { name: 'Inactive', whatsappPhone: '81901111222', status: 'INACTIVE', receiveQuotation: false, market: 'JAPAN' }),
    post('create fixed line VN', '/customers', { name: 'Máy bàn', whatsappPhone: '842838123999', market: 'VIETNAM' }),
    post('create unknown market', '/customers', { name: 'Không QG', whatsappPhone: '123456' }),
    post('create duplicate whatsapp (allowed)', '/customers', { name: 'Dup WA', whatsappPhone: '84987654321', market: 'VIETNAM' }),
    post('create empty email/phone strings', '/customers', { name: 'Rỗng', whatsappPhone: '84900000001', email: '', phone: '' }),
    post('create nulls', '/customers', { name: 'Nulls', whatsappPhone: '84900000002', company: null, email: null, phone: null, market: null, note: null }),
    post('create missing name', '/customers', { whatsappPhone: '84900000003' }),
    post('create blank name', '/customers', { name: '   ', whatsappPhone: '84900000003' }),
    post('create missing whatsapp', '/customers', { name: 'No WA' }),
    post('create bad whatsapp (letters)', '/customers', { name: 'Bad', whatsappPhone: '84abc' }),
    post('create whatsapp too short', '/customers', { name: 'Short', whatsappPhone: '12345' }),
    post('create whatsapp too long', '/customers', { name: 'Long', whatsappPhone: '1234567890123456' }),
    post('create bad phone', '/customers', { name: 'BadPhone', whatsappPhone: '84900000004', phone: '12' }),
    post('create bad email', '/customers', { name: 'BadMail', whatsappPhone: '84900000005', email: 'not-an-email' }),
    post('create bad status', '/customers', { name: 'BadStatus', whatsappPhone: '84900000006', status: 'MAYBE' }),
    post('create name too long', '/customers', { name: 'x'.repeat(300), whatsappPhone: '84900000007' }),
    post('create market too long', '/customers', { name: 'M', whatsappPhone: '84900000008', market: 'm'.repeat(81) }),
    post('create note too long', '/customers', { name: 'N', whatsappPhone: '84900000009', note: 'n'.repeat(2001) }),
    post('create unknown template id', '/customers', { name: 'GhostTpl', whatsappPhone: '84900000010', templateId: 9999 }),
    post('create templateId abc', '/customers', { name: 'AbcTpl', whatsappPhone: '84900000011', templateId: 'abc' }),
    post('create receiveQuotation wrong type', '/customers', { name: 'RQ', whatsappPhone: '84900000012', receiveQuotation: 'yes' }),
    patch('patch ok (recompute phoneType)', '/customers/1', { name: 'Đổi tên', whatsappPhone: '842838111222', market: 'VIETNAM', company: null, email: 'a@b.co' }),
    post('patch via POST? (no)', '/customers/1', { name: 'x' }),
    patch('patch partial (missing wa)', '/customers/2', { name: 'Chỉ tên' }),
    patch('patch invalid email', '/customers/2', { name: 'A', whatsappPhone: '919876000002', email: 'bad' }),
    patch('patch status/receive', '/customers/2', { name: 'A2', whatsappPhone: '919876000002', status: 'INACTIVE', receiveQuotation: false, note: 'đã khoá' }),
    patch('patch market null', '/customers/3', { name: 'B', whatsappPhone: '971501234003', market: null }),
    patch('patch unknown id', '/customers/9999', { name: 'A', whatsappPhone: '84900000099' }),
    patch('patch non-numeric id', '/customers/abc', { name: 'A', whatsappPhone: '84900000099' }),
    get('list after (verify)', '/customers/search?limit=100&sort=id'),
    get('activity', '/activity'),
  ],
};

const customersDelete: Scenario = {
  name: 'customers-delete',
  steps: [
    del('delete customer 5 (queued job -> cancelled)', '/customers/5'),
    get('batch 2 after', '/send/batches/2'),
    del('delete customer 20 (plain)', '/customers/20'),
    del('delete unknown', '/customers/9999'),
    del('delete non-numeric', '/customers/abc'),
    del('delete customer 40 (has audit log FK)', '/customers/40'),
    post('bulk empty ids', '/customers/bulk-delete', { ids: [] }),
    post('bulk no ids field', '/customers/bulk-delete', {}),
    post('bulk ids not array', '/customers/bulk-delete', { ids: '1,2' }),
    post('bulk only invalid ids', '/customers/bulk-delete', { ids: ['abc', '-1', '1.5', ''] }),
    post('bulk with hold job (6), inactive (7), unknown 9999', '/customers/bulk-delete', { ids: [6, '7', 9999, 'x'] }),
    post('bulk mix numbers/strings, dup ids', '/customers/bulk-delete', { ids: [21, '21', 22, 23] }),
    post('bulk with audit-log customer (rollback)', '/customers/bulk-delete', { ids: [24, 40] }),
    post('bulk many (>5 for sample)', '/customers/bulk-delete', { ids: [10, 11, 12, 13, 14, 15, 16, 17] }),
    get('list after', '/customers/search?limit=100'),
    get('send jobs after', '/send-jobs'),
    get('activity', '/activity'),
  ],
};

const customersImport: Scenario = {
  name: 'customers-import',
  steps: [
    post('import valid rows ({rows})', '/customers/import', {
      rows: [
        { name: 'Import A', company: 'IA', whatsappPhone: '84911000001', market: 'vietnam', email: 'a@x.co' },
        { name: 'Import B', whatsappPhone: '919811000002', market: ' india ', phone: '84911000009' },
        { name: 'Import C', whatsappPhone: '971501000003', market: 'UAE', status: 'INACTIVE', receiveQuotation: false, note: 'n' },
        { name: 'Import Fixed', whatsappPhone: '842838000004', market: 'Vietnam' },
        { name: 'Import NoMarket', whatsappPhone: '600000005' },
      ],
    }),
    post('import array body', '/customers/import', [{ name: 'Arr A', whatsappPhone: '84922000001', market: 'Japan' }, { name: 'Arr B', whatsappPhone: '84922000002' }]),
    post('import duplicates inside file', '/customers/import', {
      rows: [
        { name: 'D1', whatsappPhone: '84933000001' },
        { name: 'D1 again', whatsappPhone: '84933000001' },
        { name: 'D2', whatsappPhone: '84933000002' },
      ],
    }),
    post('import duplicates vs DB', '/customers/import', {
      rows: [
        { name: 'Exists 1', whatsappPhone: '919876000001' },
        { name: 'Exists 30 (dup in DB twice)', whatsappPhone: '971501234030' },
        { name: 'Fresh', whatsappPhone: '84944000001' },
      ],
    }),
    post('import invalid rows', '/customers/import', {
      rows: [
        { name: '', whatsappPhone: '84955000001' },
        { name: 'No WA' },
        { name: 'Bad WA', whatsappPhone: 'abc' },
        { name: 'Bad status', whatsappPhone: '84955000002', status: 'WHAT' },
        { name: 'x'.repeat(256), whatsappPhone: '84955000003' },
        { name: 'Ok after bad', whatsappPhone: '84955000004' },
        null,
        'a string row',
        42,
        [],
      ],
    }),
    post('import messy email/phone cleaned', '/customers/import', {
      rows: [
        { name: 'Two emails', whatsappPhone: '84966000001', email: 'a@x.kr b.com c@y.com', phone: '(028) 3812 3456' },
        { name: 'Bad email only', whatsappPhone: '84966000002', email: 'not mail at all', phone: '12' },
        { name: 'Phone ok', whatsappPhone: '84966000003', phone: '84901234999', market: '  korea ' },
        { name: 'Market non-string', whatsappPhone: '84966000004', market: 5 },
      ],
    }),
    post('import empty rows', '/customers/import', { rows: [] }),
    post('import {} (no rows)', '/customers/import', {}),
    post('import rows not array', '/customers/import', { rows: 'abc' }),
    get('list after', '/customers/search?limit=100&sort=name&dir=desc'),
    get('activity', '/activity'),
  ],
};

// ---------- 6. quotations ----------
const quotations: Scenario = {
  name: 'quotations',
  steps: [
    get('list quotations', '/quotations'),
    post('create minimal (auto code)', '/quotations', {}),
    post('create full', '/quotations', { code: 'BG-X-1', title: 'Đầy đủ', totalAmount: 1234.5, currency: 'USD', status: 'SENT', market: 'INDIA', issuedDate: '2026-09-01', validUntil: '2026-12-01' }),
    post('create totalAmount string', '/quotations', { code: ' BG-X-2 ', totalAmount: '99.99' }),
    post('create dates blank', '/quotations', { code: 'BG-X-3', issuedDate: '', validUntil: null }),
    post('create duplicate code', '/quotations', { code: 'BG-2026-0001' }),
    post('create invalid date', '/quotations', { code: 'BG-X-4', validUntil: 'not-a-date' }),
    post('create bad types', '/quotations', { totalAmount: true, currency: 5 }),
    post('create auto code again', '/quotations', { title: 'Tự sinh mã 2' }),
    get('detail 1', '/quotations/1'),
    get('detail 2', '/quotations/2'),
    get('detail unknown (404)', '/quotations/9999'),
    get('detail non-numeric', '/quotations/abc'),
    patch('patch title/market', '/quotations/1', { title: 'Mới', market: 'UAE' }),
    patch('patch clear fields', '/quotations/1', { title: '', market: '', validUntil: '' }),
    patch('patch dates', '/quotations/2', { issuedDate: '2026-10-01', validUntil: '2027-01-31' }),
    patch('patch code', '/quotations/3', { code: '  BG-RENAMED  ' }),
    patch('patch code empty (zod)', '/quotations/3', { code: '' }),
    patch('patch code duplicate', '/quotations/3', { code: 'BG-2026-0001' }),
    patch('patch empty', '/quotations/3', {}),
    patch('patch totalAmount (not in schema -> ignored)', '/quotations/3', { totalAmount: 5 }),
    patch('patch unknown', '/quotations/9999', { title: 'x' }),
    patch('patch non-numeric', '/quotations/abc', { title: 'x' }),
    patch('patch invalid date', '/quotations/3', { issuedDate: 'zzz' }),
    del('delete blocked by pending jobs (2)', '/quotations/2'),
    del('delete ok (3: has template -> returns to pool)', '/quotations/3'),
    del('delete with sent history (1)', '/quotations/1'),
    del('delete unknown', '/quotations/9999'),
    del('delete non-numeric', '/quotations/abc'),
    get('list after', '/quotations'),
    get('templates pool after', '/templates?pool=1'),
    get('batches after', '/send/batches'),
    get('activity', '/activity'),
  ],
};

const quotationItems: Scenario = {
  name: 'quotations-items-templates',
  steps: [
    get('items 1', '/quotations/1/items'),
    get('items unknown quotation', '/quotations/9999/items'),
    get('items non-numeric', '/quotations/abc/items'),
    put('items replace', '/quotations/1/items', {
      items: [
        { product: ' Sầu riêng A ', packing: '10kg', unit: 'kg', quantity: 100, price: 12.5, note: 'a' },
        { product: '', quantity: 5, price: 5 },
        { product: 'Không giá' },
        { no: 7, product: 'Có số thứ tự', quantity: '2.5', price: '1000.25', packing: '', unit: null, note: '' },
        { product: 'Đơn vị', unit: 'tấn', quantity: 0, price: 0 },
      ],
    }),
    get('items after replace', '/quotations/1/items'),
    get('detail after replace', '/quotations/1'),
    put('items replace empty', '/quotations/2/items', { items: [] }),
    put('items no items key (default [])', '/quotations/2/items', {}),
    put('items invalid (not array)', '/quotations/1/items', { items: 'abc' }),
    put('items invalid (bad quantity type)', '/quotations/1/items', { items: [{ product: 'x', quantity: true }] }),
    put('items no (string)', '/quotations/1/items', { items: [{ product: 'x', no: '3' }] }),
    put('items huge decimals', '/quotations/1/items', { items: [{ product: 'Big', quantity: 1234567.891, price: 99999999999.99 }] }),
    put('items on unknown quotation', '/quotations/9999/items', { items: [{ product: 'x' }] }),
    put('items on non-numeric', '/quotations/abc/items', { items: [{ product: 'x' }] }),
    get('quotation templates 1', '/quotations/1/templates'),
    get('quotation templates unknown', '/quotations/9999/templates'),
    get('quotation templates non-numeric', '/quotations/abc/templates'),
    post('create template in quotation 1', '/quotations/1/templates', { name: 'Tpl mới', subject: 'SP', icon: '🍎', body: 'Chào {khách hàng}', content: 'ignored', channelId: 1, waTemplateName: 'abc', waLanguage: 'en', waCategory: 'UTILITY', waImage: false, waBodyParams: 'a={mã}', sendAsText: true, waFlow: false, autoReply: false }),
    post('create template content alias', '/quotations/1/templates', { name: 'Alias', content: 'dùng content' }),
    post('create template channelId string/null', '/quotations/2/templates', { name: 'Ch', channelId: '2' }),
    post('create template null channel', '/quotations/2/templates', { name: 'NoCh', channelId: null }),
    post('create template empty name', '/quotations/1/templates', { name: '' }),
    post('create template missing name', '/quotations/1/templates', {}),
    post('create template bad types', '/quotations/1/templates', { name: 'x', waImage: 'no' }),
    post('create template unknown channel', '/quotations/1/templates', { name: 'x', channelId: 9999 }),
    post('create template unknown quotation', '/quotations/9999/templates', { name: 'x' }),
    post('create template non-numeric quotation', '/quotations/abc/templates', { name: 'x' }),
    get('quotation templates after', '/quotations/1/templates'),
    get('activity', '/activity'),
  ],
};

// ---------- 7. templates ----------
const templatesRead: Scenario = {
  name: 'templates-read',
  steps: [
    get('list plain', '/templates'),
    get('list pool', '/templates?pool=1'),
    get('list pool=0 (truthy string)', '/templates?pool=0'),
    get('list page=1&limit=3', '/templates?page=1&limit=3'),
    get('list page=2&limit=2', '/templates?page=2&limit=2'),
    get('list limit=500 clamp', '/templates?page=1&limit=500'),
    get('list page=0', '/templates?page=0'),
    get('list page=abc', '/templates?page=abc'),
    get('list search=sầu', '/templates?search=' + encodeURIComponent('sầu')),
    get('list search empty (paged)', '/templates?search='),
    get('list search by meta name', '/templates?search=BAOGIA_thanh'),
    get('list search by quotation code', '/templates?search=bg-2026-0002'),
    get('list kind=send', '/templates?page=1&kind=send'),
    get('list kind=reply', '/templates?page=1&kind=reply'),
    get('list kind=other', '/templates?page=1&kind=other'),
    get('list kind only (no page => plain)', '/templates?kind=reply'),
    get('detail 1', '/templates/1'),
    get('detail 4 (no quotation)', '/templates/4'),
    get('detail unknown (404)', '/templates/9999'),
    get('detail non-numeric', '/templates/abc'),
    get('quotation templates', '/quotations/1/templates'),
  ],
};

const templatesWrite: Scenario = {
  name: 'templates-write',
  steps: [
    post('create standalone', '/templates', { name: 'Standalone', subject: 'SP', body: 'Hi {khách hàng}' }),
    post('create standalone with channel+wa', '/templates', { name: 'WA Standalone', channelId: 1, waTemplateName: 'meta_x', waLanguage: 'vi', waCategory: 'MARKETING', waBodyParams: 'customer_name={khách hàng}', waImage: true, waFlow: true, sendAsText: false, icon: '🍈' }),
    post('create standalone autoReply true', '/templates', { name: 'Reply new', autoReply: true, waTemplateName: 'reply_x' }),
    post('create standalone content alias', '/templates', { name: 'Alias', content: 'nội dung alias' }),
    post('create standalone empty name', '/templates', { name: '' }),
    post('create standalone missing name', '/templates', {}),
    post('create standalone bad types', '/templates', { name: 'x', sendAsText: 'maybe' }),
    post('create standalone unknown channel', '/templates', { name: 'x', channelId: 9999 }),
    post('create standalone channel abc', '/templates', { name: 'x', channelId: 'abc' }),
    get('quotations (auto-created)', '/quotations'),
    patch('patch name/body', '/templates/1', { name: 'Đã đổi', body: 'Nội dung mới', subject: 'SP mới', icon: null }),
    patch('patch channel null', '/templates/1', { channelId: null }),
    patch('patch channel 2', '/templates/1', { channelId: '2' }),
    patch('patch quotation null (to pool)', '/templates/2', { quotationId: null }),
    patch('patch quotation attach', '/templates/5', { quotationId: 2 }),
    patch('patch quotation unknown', '/templates/5', { quotationId: 9999 }),
    patch('patch wa fields', '/templates/3', { waTemplateName: 'new_meta', waLanguage: 'en', waCategory: null, waImage: false, waFlow: false, sendAsText: true, waBodyParams: '' }),
    patch('patch waTemplateName null', '/templates/3', { waTemplateName: null }),
    patch('patch autoReply true (others off)', '/templates/4', { autoReply: true }),
    patch('patch autoReply true on 5 (turns 4 off)', '/templates/5', { autoReply: true }),
    patch('patch autoReply false', '/templates/5', { autoReply: false }),
    patch('patch content alias', '/templates/6', { content: 'qua content' }),
    patch('patch empty', '/templates/6', {}),
    patch('patch invalid type', '/templates/6', { waImage: 'x' }),
    patch('patch unknown', '/templates/9999', { name: 'x' }),
    patch('patch non-numeric', '/templates/abc', { name: 'x' }),
    patch('patch autoReply unknown (tx rollback)', '/templates/9999', { autoReply: true }),
    post('sync-meta (no creds)', '/templates/sync-meta'),
    del('delete 5', '/templates/5'),
    del('delete 4 (reply template)', '/templates/4'),
    del('delete with sent history (1)', '/templates/1'),
    del('delete unknown', '/templates/9999'),
    del('delete non-numeric', '/templates/abc'),
    get('list after', '/templates'),
    get('batches after', '/send/batches'),
    get('activity', '/activity'),
  ],
};

const templatesCustomers: Scenario = {
  name: 'templates-customers',
  steps: [
    get('customers of 1', '/templates/1/customers'),
    get('customers of 4 (empty)', '/templates/4/customers'),
    get('customers unknown template', '/templates/9999/customers'),
    get('customers non-numeric', '/templates/abc/customers'),
    post('create customer in template 4', '/templates/4/customers', { name: 'Trong Tpl', whatsappPhone: '84977000001', market: 'VIETNAM' }),
    post('create customer invalid', '/templates/4/customers', { name: '', whatsappPhone: 'x' }),
    post('create customer unknown template', '/templates/9999/customers', { name: 'Ghost', whatsappPhone: '84977000002' }),
    post('create customer template abc', '/templates/abc/customers', { name: 'Abc', whatsappPhone: '84977000003' }),
    post('link bulk', '/templates/4/customers/link', { customerIds: [10, '11', 12, 12] }),
    post('link bulk with existing (skip dup)', '/templates/4/customers/link', { customerIds: [10, 13] }),
    post('link bulk empty', '/templates/4/customers/link', { customerIds: [] }),
    post('link bulk not array', '/templates/4/customers/link', { customerIds: 'x' }),
    post('link bulk no body keys', '/templates/4/customers/link', {}),
    post('link bulk invalid id', '/templates/4/customers/link', { customerIds: ['abc'] }),
    post('link bulk unknown customer', '/templates/4/customers/link', { customerIds: [9999] }),
    post('link bulk unknown template', '/templates/9999/customers/link', { customerIds: [1] }),
    post('unlink bulk', '/templates/4/customers/unlink', { customerIds: [10, '11', 9999] }),
    post('unlink bulk empty', '/templates/4/customers/unlink', { customerIds: [] }),
    post('unlink bulk none', '/templates/4/customers/unlink', {}),
    post('unlink invalid id', '/templates/4/customers/unlink', { customerIds: ['abc'] }),
    post('unlink all of template 1', '/templates/1/customers/unlink', { customerIds: [1, 2, 3, 4, 7, 8, 9] }),
    post('add one customer', '/templates/4/customers/20'),
    post('add one customer again (upsert)', '/templates/4/customers/20'),
    post('add unknown customer', '/templates/4/customers/9999'),
    post('add to unknown template', '/templates/9999/customers/20'),
    post('add non-numeric', '/templates/4/customers/abc'),
    del('remove one customer', '/templates/4/customers/20'),
    del('remove one again', '/templates/4/customers/20'),
    del('remove unknown', '/templates/4/customers/9999'),
    del('remove non-numeric', '/templates/4/customers/abc'),
    get('customers of 4 after', '/templates/4/customers'),
    get('customers search idsOnly t=4', '/customers/search?idsOnly=1&templateId=4'),
    get('activity', '/activity'),
  ],
};

const templatesImage: Scenario = {
  name: 'templates-image',
  steps: [
    get('GET image none (404 text)', '/templates/1/image'),
    get('GET image unknown template', '/templates/9999/image'),
    get('GET image non-numeric', '/templates/abc/image'),
    { name: 'POST png', method: 'POST', path: '/templates/1/image', bytes: PNG, contentType: 'image/png' },
    get('GET image after upload', '/templates/1/image'),
    get('detail shows image meta', '/templates/1'),
    { name: 'POST jpeg (replace)', method: 'POST', path: '/templates/1/image', bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fakejpeg')]), contentType: 'image/jpeg' },
    get('GET image after replace', '/templates/1/image'),
    { name: 'POST png with charset param', method: 'POST', path: '/templates/2/image', bytes: PNG, contentType: 'image/png; charset=binary' },
    get('GET image 2', '/templates/2/image'),
    get('GET image 3', '/templates/3/image'),
    { name: 'POST text/plain (not image)', method: 'POST', path: '/templates/4/image', bytes: Buffer.from('hello'), contentType: 'text/plain' },
    { name: 'POST application/json (not image)', method: 'POST', path: '/templates/4/image', text: '{"a":1}', contentType: 'application/json' },
    { name: 'POST image/png empty body', method: 'POST', path: '/templates/4/image', bytes: Buffer.alloc(0), contentType: 'image/png' },
    { name: 'POST image/png > 5MB', method: 'POST', path: '/templates/4/image', bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 7), contentType: 'image/png' },
    { name: 'POST image/png exactly 5MB', method: 'POST', path: '/templates/5/image', bytes: Buffer.alloc(5 * 1024 * 1024, 9), contentType: 'image/png' },
    { name: 'POST image/webp small', method: 'POST', path: '/templates/6/image', bytes: Buffer.from('RIFFxxxxWEBP'), contentType: 'image/webp' },
    { name: 'POST png unknown template (FK)', method: 'POST', path: '/templates/9999/image', bytes: PNG, contentType: 'image/png' },
    { name: 'POST png non-numeric template', method: 'POST', path: '/templates/abc/image', bytes: PNG, contentType: 'image/png' },
    del('DELETE image', '/templates/1/image'),
    get('GET image after delete (404)', '/templates/1/image'),
    del('DELETE image again', '/templates/1/image'),
    del('DELETE image unknown template', '/templates/9999/image'),
    del('DELETE image non-numeric', '/templates/abc/image'),
    del('delete template 2 (cascade image)', '/templates/2'),
    get('activity', '/activity'),
  ],
};

const templateGuards: Scenario = {
  name: 'delete-guards-pending-jobs',
  steps: [
    del('delete template 3 blocked (pending jobs)', '/templates/3'),
    del('delete quotation 2 blocked (pending jobs)', '/quotations/2'),
    post('cancel batch 2 (queued + hold -> FAILED)', '/send/cancel', { batchId: 2 }),
    get('batch 2 after cancel', '/send/batches/2'),
    del('delete template 3 now ok', '/templates/3'),
    del('delete quotation 2 now ok', '/quotations/2'),
    get('batches after', '/send/batches'),
    get('send jobs after', '/send-jobs'),
    get('activity', '/activity'),
  ],
};

// ---------- 8. send ----------
const sendFlow: Scenario = {
  name: 'send-flow',
  cooldownMs: 32_000,
  steps: [
    post('preview empty body obj', '/send/preview', {}),
    post('preview unknown template', '/send/preview', { templateId: 9999 }),
    post('preview template without quotation (5)', '/send/preview', { templateId: 5 }),
    post('preview template without eligible customers (6)', '/send/preview', { templateId: 6 }),
    post('preview templateId abc', '/send/preview', { templateId: 'abc' }),
    post('preview bad types', '/send/preview', { templateId: true }),
    post('preview A (template 1, WA)', '/send/preview', { templateId: 1, actor: { id: 2, name: 'Actor Body' } }, { sleepAfter: 1200, capture: (r, v) => (v.A = j(r).batch?.id) }),
    post('preview B (template 2, telegram, string id)', '/send/preview', { templateId: '2', channelId: null }, { sleepAfter: 1200, capture: (r, v) => (v.B = j(r).batch?.id) }),
    post('preview C (template 1 override channel 2)', '/send/preview', { templateId: 1, channelId: 2 }, { sleepAfter: 1200, capture: (r, v) => (v.C = j(r).batch?.id) }),
    post('preview D (template 3, WA, 2 customers)', '/send/preview', { templateId: 3 }, { sleepAfter: 1200, capture: (r, v) => (v.D = j(r).batch?.id) }),
    (v) => post('confirm A', '/send/confirm', { batchId: v.A }),
    (v) => post('confirm A again', '/send/confirm', { batchId: v.A }),
    post('confirm unknown', '/send/confirm', { batchId: 9999 }),
    post('confirm empty', '/send/confirm', {}),
    post('confirm batchId abc', '/send/confirm', { batchId: 'abc' }),
    (v) => post('confirm B with body actor', '/send/confirm', { batchId: v.B, actor: { id: '1', name: 'Body Actor' } }),
    (v) => post('cancel C before confirm', '/send/cancel', { batchId: v.C }),
    (v) => post('cancel C again', '/send/cancel', { batchId: v.C }),
    (v) => post('confirm C after cancel', '/send/confirm', { batchId: v.C }),
    (v) => post('cancel B after confirm (jobs -> FAILED)', '/send/cancel', { batchId: v.B }),
    post('cancel unknown', '/send/cancel', { batchId: 9999 }),
    post('cancel empty', '/send/cancel', {}),
    (v) => post('confirm D', '/send/confirm', { batchId: v.D }),
    {
      name: 'process loop',
      method: 'POST',
      path: '/send/process',
      repeat: { max: 8, until: (r) => j(r).processed === false },
      timeoutMs: 120_000,
    },
    get('GET batches', '/send/batches', { sleepAfter: 32_000 }),
    get('GET batches again (fresh after quota cache expiry)', '/send/batches'),
    (v) => get('GET batch A', `/send/batches/${v.A}`),
    (v) => get('GET batch B (cancelled)', `/send/batches/${v.B}`),
    (v) => get('GET batch C', `/send/batches/${v.C}`),
    get('GET batch unknown (404)', '/send/batches/9999'),
    get('GET batch non-numeric', '/send/batches/abc'),
    get('GET send-jobs', '/send-jobs'),
    get('GET dashboard', '/dashboard', { sortArrays: ['batchStatus'] }),
    post('preview E after sends (quota used24h)', '/send/preview', { templateId: 1 }, { capture: (r, v) => (v.E = j(r).batch?.id) }),
    get('GET activity', '/activity'),
    get('GET inbound', '/inbound'),
  ],
};

const sendCron: Scenario = {
  name: 'cron-and-process',
  cooldownMs: 32_000,
  steps: [
    post('process (picks seeded queued job)', '/send/process'),
    get('cron process-sends GET (drains queue)', '/cron/process-sends', { timeoutMs: 120_000 }),
    post('cron process-sends POST (empty)', '/cron/process-sends'),
    post('process empty queue', '/send/process'),
    get('batches', '/send/batches', { sleepAfter: 32_000 }),
    get('send-jobs', '/send-jobs'),
    get('dashboard', '/dashboard', { sortArrays: ['batchStatus'] }),
    get('cron zalo-token GET (no token)', '/cron/zalo-token'),
    post('cron zalo-token POST (no token)', '/cron/zalo-token'),
    get('cron cleanup-logs GET', '/cron/cleanup-logs'),
    post('cron cleanup-logs POST (nothing left)', '/cron/cleanup-logs'),
    get('activity after cleanup', '/activity'),
    get('inbound after cleanup', '/inbound'),
    get('send-jobs after cleanup', '/send-jobs'),
  ],
};

const cronZaloToken: Scenario = {
  name: 'cron-zalo-token-with-expired-token',
  setup: seedExpiredZaloToken,
  steps: [
    get('cron zalo-token GET (refresh fails: no secret)', '/cron/zalo-token'),
    post('cron zalo-token POST', '/cron/zalo-token'),
    get('zalo status', '/zalo/status'),
    get('activity', '/activity'),
  ],
};

const readonlyLists: Scenario = {
  name: 'readonly-lists',
  steps: [
    get('activity', '/activity'),
    get('inbound', '/inbound'),
    get('dashboard', '/dashboard', { sortArrays: ['batchStatus'] }),
    get('send batches', '/send/batches'),
    get('send batch 1', '/send/batches/1'),
    get('send batch 2', '/send/batches/2'),
    get('send batch 3 (preview, no jobs)', '/send/batches/3'),
    get('send batch unknown', '/send/batches/9999'),
    get('send-jobs', '/send-jobs'),
    get('customers markets', '/customers/markets'),
  ],
};

// ---------- 9. webhooks ----------
const waVerify: Scenario = {
  name: 'webhook-whatsapp-verify',
  steps: [
    get('verify ok', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=CHALLENGE123`),
    get('verify ok no challenge', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}`),
    get('verify wrong token', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=C'),
    get('verify wrong mode', `/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=C`),
    get('verify missing params', '/webhooks/whatsapp'),
    get('verify empty token', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=C'),
    get('verify challenge unicode', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=${encodeURIComponent('xin chào 123')}`),
    get('zalo ping', '/webhooks/zalo'),
  ],
};

const waValue = (value: Record<string, unknown>, entryId = 'WABA-777') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: entryId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001', phone_number_id: 'PHONEID-1' }, ...value } }] }],
});
const waPost = (name: string, body: unknown, x: Extra = {}): StepSpec => rawJson(name, 'POST', '/webhooks/whatsapp', typeof body === 'string' ? body : JSON.stringify(body), { noActor: true, ...x });

const waEvents: Scenario = {
  name: 'webhook-whatsapp-events',
  steps: [
    waPost('status delivered', waValue({ statuses: [{ id: 'wamid.PARITY001', status: 'delivered', timestamp: '1760000000', recipient_id: '919876000001' }] })),
    waPost('status read', waValue({ statuses: [{ id: 'wamid.PARITY002', status: 'read', timestamp: '1760000001', recipient_id: '919876000002' }] })),
    waPost('status failed with error code', waValue({
      statuses: [{ id: 'wamid.PARITY001', status: 'failed', timestamp: '1760000002', errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message Undeliverable', error_data: { details: 'Unable to deliver' } }] }],
    })),
    waPost('status failed error without details', waValue({ statuses: [{ id: 'wamid.PARITY002', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement' , message: 'msg only' }] }] })),
    waPost('status failed no errors', waValue({ statuses: [{ id: 'wamid.PARITY001', status: 'failed' }] })),
    waPost('status sent (upper/lower)', waValue({ statuses: [{ id: 'wamid.PARITY002', status: 'sent' }] })),
    waPost('status unknown id', waValue({ statuses: [{ id: 'wamid.NOPE', status: 'read' }] })),
    waPost('status missing fields', waValue({ statuses: [{}, { id: 'x' }, { status: 'read' }, null] })),
    waPost('multiple statuses', waValue({ statuses: [{ id: 'wamid.PARITY001', status: 'delivered' }, { id: 'wamid.PARITY002', status: 'read' }] })),
    waPost('inbound text from customer 4 (+profile)', waValue({
      contacts: [{ profile: { name: 'Khach Bốn WA' }, wa_id: '84912345604' }],
      messages: [{ from: '84912345604', id: 'wamid.NEW001', timestamp: '1760000010', type: 'text', text: { body: 'Cho tôi xin giá sầu riêng' } }],
    })),
    waPost('inbound duplicate id (dedupe)', waValue({
      contacts: [{ profile: { name: 'Khach Bốn WA' }, wa_id: '84912345604' }],
      messages: [{ from: '84912345604', id: 'wamid.NEW001', timestamp: '1760000010', type: 'text', text: { body: 'dup' } }],
    })),
    waPost('inbound from unknown phone', waValue({
      contacts: [{ profile: { name: 'Người Lạ' }, wa_id: '15550001111' }],
      messages: [{ from: '15550001111', id: 'wamid.NEW002', type: 'text', text: { body: 'hello' } }],
    })),
    waPost('inbound unknown phone no profile', waValue({ messages: [{ from: '15550002222', id: 'wamid.NEW003', type: 'text', text: { body: 'no name' } }] })),
    waPost('inbound with +84 formatted from (suffix match)', waValue({ messages: [{ from: '+84 912 345 605', id: 'wamid.NEW004', type: 'text', text: { body: 'suffix' } }] })),
    waPost('inbound matching customer.phone field (21)', waValue({ messages: [{ from: '84280000021', id: 'wamid.NEW005', type: 'text', text: { body: 'x' } }] })),
    waPost('inbound button reply', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW006', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Đặt hàng' } } }] })),
    waPost('inbound list reply', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW007', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'Mục 1' } } }] })),
    waPost('inbound interactive unknown', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW008', type: 'interactive', interactive: {} }] })),
    waPost('inbound template button', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW009', type: 'button', button: { text: 'Quan tâm', payload: 'p' } }] })),
    waPost('inbound tracking button (forward disabled)', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW010', type: 'button', button: { text: 'Confirm Goods Received', payload: 'ago:received:abc' } }] })),
    waPost('inbound flow nfm_reply', waValue({
      messages: [{ from: '84912345604', id: 'wamid.NEW011', type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: 't', screen_0_Name_of_product_0: 'Sầu riêng', screen_0_Quatity_1: '10', Destination_port: 'Mumbai' }) } } }],
    })),
    waPost('inbound image', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW012', type: 'image', image: { id: 'img1' } }] })),
    waPost('inbound no type', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW013' }] })),
    waPost('inbound no id', waValue({ messages: [{ from: '84912345604', type: 'text', text: { body: 'no id' } }] })),
    waPost('inbound no from', waValue({ messages: [{ id: 'wamid.NEW014', type: 'text', text: { body: 'no from' } }] })),
    waPost('inbound text without body', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW015', type: 'text' }] })),
    waPost('message + status same body', waValue({
      statuses: [{ id: 'wamid.PARITY001', status: 'read' }],
      messages: [{ from: '84912345606', id: 'wamid.NEW016', type: 'text', text: { body: 'combo' } }],
    })),
    waPost('two entries, two changes', {
      entry: [
        { id: 'WABA-A', changes: [{ value: { messages: [{ from: '84912345604', id: 'wamid.NEW017', type: 'text', text: { body: 'e1c1' } }] } }, { value: { messages: [{ from: '84912345605', id: 'wamid.NEW018', type: 'text', text: { body: 'e1c2' } }] } }] },
        { id: 'WABA-B', changes: [{ value: { statuses: [{ id: 'wamid.PARITY002', status: 'delivered' }] } }] },
      ],
    }),
    waPost('entry without id', { entry: [{ changes: [{ value: { messages: [{ from: '84912345604', id: 'wamid.NEW019', type: 'text', text: { body: 'noid' } }] } }] }] }),
    waPost('entry changes not array', { entry: [{ id: 'W', changes: 'x' }] }),
    waPost('entry not array', { entry: 'x' }),
    waPost('entry empty array', { entry: [] }),
    waPost('empty object', {}),
    waPost('json array body', '[1,2,3]'),
    waPost('json null body', 'null'),
    waPost('json string body', '"hello"'),
    waPost('malformed json', '{not json'),
    waPost('empty body', ''),
    { name: 'text/plain valid json body', method: 'POST', path: '/webhooks/whatsapp', text: JSON.stringify(waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW020', type: 'text', text: { body: 'text/plain ctype' } }] })), contentType: 'text/plain', noActor: true },
    { name: 'no content-type valid json body', method: 'POST', path: '/webhooks/whatsapp', text: JSON.stringify(waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW021', type: 'text', text: { body: 'no ctype' } }] })), noActor: true },
    { name: 'form-urlencoded body', method: 'POST', path: '/webhooks/whatsapp', text: 'a=1&b=2', contentType: 'application/x-www-form-urlencoded', noActor: true },
    waPost('large text body', waValue({ messages: [{ from: '84912345604', id: 'wamid.NEW022', type: 'text', text: { body: 'x'.repeat(20000) } }] })),
    get('inbound list', '/inbound'),
    get('send jobs', '/send-jobs'),
    get('activity', '/activity'),
  ],
};

const waAutoReply: Scenario = {
  name: 'webhook-whatsapp-autoreply',
  steps: [
    waPost('inbound before auto-reply configured', waValue({
      contacts: [{ profile: { name: 'Bốn' }, wa_id: '84912345604' }],
      messages: [{ from: '84912345604', id: 'wamid.AR001', type: 'text', text: { body: 'trước khi bật' } }],
    })),
    patch('enable autoReply on template 4', '/templates/4', { autoReply: true }),
    waPost('inbound customer 4 -> auto reply (dry-run)', waValue({
      contacts: [{ profile: { name: 'Bốn' }, wa_id: '84912345604' }],
      messages: [{ from: '84912345604', id: 'wamid.AR002', type: 'text', text: { body: 'bật rồi' } }],
    })),
    waPost('inbound customer 4 again (cooldown)', waValue({
      messages: [{ from: '84912345604', id: 'wamid.AR003', type: 'text', text: { body: 'lần 2' } }],
    })),
    waPost('inbound customer 5 -> auto reply + link customer', waValue({
      messages: [{ from: '84912345605', id: 'wamid.AR004', type: 'text', text: { body: 'khách 5' } }],
    })),
    waPost('inbound unknown phone -> auto reply with profile name', waValue({
      contacts: [{ profile: { name: 'Lạ Hoắc' }, wa_id: '15559990000' }],
      messages: [{ from: '15559990000', id: 'wamid.AR005', type: 'text', text: { body: 'khách lạ' } }],
    })),
    waPost('inbound unknown phone no profile -> fallback name', waValue({
      messages: [{ from: '15559990001', id: 'wamid.AR006', type: 'text', text: { body: 'ẩn danh' } }],
    })),
    waPost('flow response -> auto reply', waValue({
      messages: [{ from: '919876000002', id: 'wamid.AR007', type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({ Name_of_product: 'X' }) } } }],
    })),
    get('template 4 customers (auto-linked)', '/templates/4/customers'),
    get('inbound', '/inbound'),
    get('activity (TU_DONG_TRA_LOI)', '/activity'),
  ],
};

// ---------- 10. webhook zalo ----------
const zaloSign = (raw: string, ts: string) =>
  'mac=' + crypto.createHash('sha256').update(ZALO_APP_ID + raw + ts + ZALO_WEBHOOK_SECRET).digest('hex');
const zaloPost = (name: string, body: Record<string, unknown>, opt: { sig?: 'ok' | 'bad' | 'none' | 'upper' | 'nomac'; ts?: string } = {}): StepSpec => {
  const raw = JSON.stringify(body);
  const ts = String(opt.ts ?? body.timestamp ?? '');
  const headers: Record<string, string> = {};
  const sig = opt.sig ?? 'ok';
  if (sig === 'ok') headers['x-zevent-signature'] = zaloSign(raw, ts);
  else if (sig === 'upper') headers['x-zevent-signature'] = zaloSign(raw, ts).toUpperCase().replace(/^MAC=/, 'mac=');
  else if (sig === 'nomac') headers['x-zevent-signature'] = zaloSign(raw, ts).replace(/^mac=/, '');
  else if (sig === 'bad') headers['x-zevent-signature'] = 'mac=' + 'ab'.repeat(32);
  return { name, method: 'POST', path: '/webhooks/zalo', text: raw, contentType: 'application/json', headers, noActor: true };
};
const zEvt = (event_name: string, extra: Record<string, unknown>) => ({
  app_id: ZALO_APP_ID, event_name, timestamp: '1760000000123', recipient: { id: 'OA-1' }, ...extra,
});

const zaloWebhook: Scenario = {
  name: 'webhook-zalo',
  steps: [
    zaloPost('text from unknown user (valid sig)', zEvt('user_send_text', { sender: { id: 'zuid-200' }, message: { text: 'Xin chào OA', msg_id: 'zmsg-1' } })),
    zaloPost('same msg again (dedupe)', zEvt('user_send_text', { sender: { id: 'zuid-200' }, message: { text: 'Xin chào OA', msg_id: 'zmsg-1' } })),
    zaloPost('image', zEvt('user_send_image', { sender: { id: 'zuid-201' }, message: { msg_id: 'zmsg-2', attachments: [] } })),
    zaloPost('sticker', zEvt('user_send_sticker', { sender: { id: 'zuid-201' }, message: { msg_id: 'zmsg-3' } })),
    zaloPost('file/gif/audio/video/location/link', zEvt('user_send_link', { sender: { id: 'zuid-202' }, message: { msg_id: 'zmsg-4', text: 'http://x' } })),
    zaloPost('location', zEvt('user_send_location', { sender: { id: 'zuid-202' }, message: { msg_id: 'zmsg-5' } })),
    zaloPost('text with no msg_id', zEvt('user_send_text', { sender: { id: 'zuid-203' }, message: { text: 'no id' } })),
    zaloPost('text no message', zEvt('user_send_text', { sender: { id: 'zuid-204' } })),
    zaloPost('unknown user_send_ event', zEvt('user_send_whatever', { sender: { id: 'zuid-205' }, message: { msg_id: 'zmsg-6', text: 'odd' } })),
    zaloPost('follow', zEvt('follow', { follower: { id: 'zuid-300' } })),
    zaloPost('follow again (same ts -> dedupe)', zEvt('follow', { follower: { id: 'zuid-300' } })),
    zaloPost('follow without follower', zEvt('follow', {})),
    zaloPost('oa_send_text ignored', zEvt('oa_send_text', { sender: { id: 'OA-1' }, recipient: { id: 'zuid-200' }, message: { text: 'reply', msg_id: 'zmsg-7' } })),
    zaloPost('unfollow ignored', zEvt('unfollow', { follower: { id: 'zuid-300' } })),
    zaloPost('text without sender', zEvt('user_send_text', { message: { text: 'x', msg_id: 'zmsg-8' } })),
    zaloPost('invalid signature', zEvt('user_send_text', { sender: { id: 'zuid-400' }, message: { text: 'bad sig', msg_id: 'zmsg-9' } }), { sig: 'bad' }),
    zaloPost('missing signature', zEvt('user_send_text', { sender: { id: 'zuid-401' }, message: { text: 'no sig', msg_id: 'zmsg-10' } }), { sig: 'none' }),
    zaloPost('signature without mac= prefix', zEvt('user_send_text', { sender: { id: 'zuid-402' }, message: { text: 'nomac', msg_id: 'zmsg-11' } }), { sig: 'nomac' }),
    zaloPost('signature uppercase hex', zEvt('user_send_text', { sender: { id: 'zuid-403' }, message: { text: 'upper', msg_id: 'zmsg-12' } }), { sig: 'upper' }),
    zaloPost('signature for wrong timestamp', zEvt('user_send_text', { sender: { id: 'zuid-404' }, message: { text: 'wrong ts', msg_id: 'zmsg-13' } }), { ts: '999' }),
    zaloPost('no timestamp in body (sig over empty ts)', { app_id: ZALO_APP_ID, event_name: 'user_send_text', sender: { id: 'zuid-405' }, recipient: { id: 'OA-1' }, message: { text: 'no ts', msg_id: 'zmsg-14' } }),
    { name: 'malformed json', method: 'POST', path: '/webhooks/zalo', text: '{oops', contentType: 'application/json', headers: { 'x-zevent-signature': 'mac=abc' }, noActor: true },
    { name: 'empty body', method: 'POST', path: '/webhooks/zalo', text: '', contentType: 'application/json', noActor: true },
    { name: 'json null body', method: 'POST', path: '/webhooks/zalo', text: 'null', contentType: 'application/json', noActor: true },
    { name: 'text/plain ctype valid sig', method: 'POST', path: '/webhooks/zalo', ...(() => { const b = zEvt('user_send_text', { sender: { id: 'zuid-500' }, message: { text: 'plain', msg_id: 'zmsg-15' } }); const raw = JSON.stringify(b); return { text: raw, contentType: 'text/plain', headers: { 'x-zevent-signature': zaloSign(raw, '1760000000123') } }; })(), noActor: true },
    // Kích hoạt Zalo bằng mã 6 số: lấy mã thật từ API rồi nhắn vào OA qua webhook.
    post('link-code for user 1', '/users/1/zalo/link-code', undefined, { maskKeys: ['code'], capture: (r, v) => (v.code = j(r).code) }),
    (v) => zaloPost('send link code from new zalo user', zEvt('user_send_text', { sender: { id: 'zuid-600' }, message: { text: String(v.code), msg_id: 'zmsg-16' } })),
    get('user 1 zalo status (linked)', '/users/1/zalo'),
    zaloPost('linked user messages OA (ignored)', zEvt('user_send_text', { sender: { id: 'zuid-600' }, message: { text: 'tôi là nhân viên', msg_id: 'zmsg-17' } })),
    zaloPost('wrong 6-digit code', zEvt('user_send_text', { sender: { id: 'zuid-601' }, message: { text: '000000', msg_id: 'zmsg-18' } })),
    zaloPost('seeded expired code 111111', zEvt('user_send_text', { sender: { id: 'zuid-602' }, message: { text: '111111', msg_id: 'zmsg-19' } })),
    zaloPost('code with spaces', zEvt('user_send_text', { sender: { id: 'zuid-603' }, message: { text: '  12345  ', msg_id: 'zmsg-20' } })),
    post('link-code for user 2 (already bound)', '/users/2/zalo/link-code', undefined, { maskKeys: ['code'], capture: (r, v) => (v.code2 = j(r).code) }),
    (v) => zaloPost('rebind: new zalo uid for user 2', zEvt('user_send_text', { sender: { id: 'zuid-700' }, message: { text: String(v.code2), msg_id: 'zmsg-21' } })),
    get('users (bindings)', '/users'),
    get('receive channels', '/receive-channels'),
    get('zalo senders', '/zalo/senders'),
    get('zalo status (webhookLastAt)', '/zalo/status'),
    get('inbound', '/inbound'),
    get('activity', '/activity'),
  ],
};

// ---------- 11. zalo admin ----------
const zaloAdmin: Scenario = {
  name: 'zalo-admin-no-token',
  steps: [
    get('status (no token)', '/zalo/status'),
    get('status via x-forwarded headers', '/zalo/status', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'fwd.example.com' } }),
    post('check (no token)', '/zalo/check'),
    post('refresh (no token)', '/zalo/refresh'),
    post('test (empty body)', '/zalo/test', {}),
    post('test (userId only, no token)', '/zalo/test', { userId: 'zuid-1' }),
    post('test (userId + text)', '/zalo/test', { userId: ' zuid-1 ', text: 'hello' }),
    post('disconnect (nothing)', '/zalo/disconnect'),
    post('oauth start (no secret -> error)', '/zalo/oauth/start', {}),
    post('oauth start with callbackUrl', '/zalo/oauth/start', { callbackUrl: 'https://cb.example.com/cb' }),
    post('oauth exchange empty', '/zalo/oauth/exchange', {}),
    post('oauth exchange code only (no verifier)', '/zalo/oauth/exchange', { code: 'abc123' }),
    post('oauth exchange url form', '/zalo/oauth/exchange', { url: 'https://x.test/cb?oa_id=OA-9&code=zzz&state=s1' }),
    post('oauth exchange query-string form', '/zalo/oauth/exchange', { code: 'code=zzz&oa_id=OA-9&state=s1' }),
    post('oauth exchange garbage url', '/zalo/oauth/exchange', { url: 'ht!tp://[bad' }),
    get('oauth callback no code', '/zalo/oauth/callback'),
    get('oauth callback no code + oa_id/state', '/zalo/oauth/callback?oa_id=OA-1&state=abc'),
    get('oauth callback with code (no verifier)', '/zalo/oauth/callback?code=abc&oa_id=OA-1&state=s'),
    get('oauth callback code with special chars', '/zalo/oauth/callback?code=' + encodeURIComponent('a b&c'),),
    get('senders (empty)', '/zalo/senders'),
    get('shared-users (disabled)', '/zalo/shared-users'),
    get('activity', '/activity'),
  ],
};

const zaloAdminToken: Scenario = {
  name: 'zalo-admin-expired-token',
  setup: seedExpiredZaloToken,
  steps: [
    get('status (expired token row)', '/zalo/status'),
    post('check (token present -> refresh fails)', '/zalo/check'),
    post('refresh (fails: no secret)', '/zalo/refresh'),
    post('test userId (refresh fails)', '/zalo/test', { userId: 'zuid-1' }),
    get('senders', '/zalo/senders'),
    post('disconnect', '/zalo/disconnect'),
    get('status after disconnect', '/zalo/status'),
    post('disconnect again', '/zalo/disconnect'),
    get('activity', '/activity'),
  ],
};

const zaloOauth: Scenario = {
  name: 'zalo-oauth-with-pkce',
  setup: (db) => seedPkce(db, 'state-good'),
  steps: [
    get('status shows pendingAuthSince', '/zalo/status', { maskKeys: ['pendingAuthSince'] }),
    post('exchange wrong state', '/zalo/oauth/exchange', { code: 'abc', state: 'state-bad' }),
    post('exchange good state (callOAuth -> config error)', '/zalo/oauth/exchange', { code: 'abc', state: 'state-good', oaId: 'OA-77' }),
    post('exchange no state', '/zalo/oauth/exchange', { code: 'abc' }),
    get('callback wrong state', '/zalo/oauth/callback?code=abc&oa_id=OA-1&state=state-bad'),
    get('callback good state', '/zalo/oauth/callback?code=abc&oa_id=OA-1&state=state-good'),
    get('status', '/zalo/status', { maskKeys: ['pendingAuthSince'] }),
    post('disconnect clears pkce', '/zalo/disconnect'),
    get('status after', '/zalo/status'),
  ],
};


// ---------- 12. biên của body JSON (mỗi bước cô lập) ----------
// Next: req.json() (bỏ qua content-type; rỗng/hỏng => ném). Nest: body-parser Express (chỉ application/json; rỗng => {}; chặn null/chuỗi trần).
const edgeCases = (label: string, method: string, path: string, valid: unknown): StepSpec[] => {
  const t = JSON.stringify(valid);
  return [
    { name: label + ' | control application/json;charset', method, path, text: t, contentType: 'application/json; charset=utf-8' },
    { name: label + ' | empty body', method, path, text: '', contentType: 'application/json' },
    { name: label + ' | malformed json', method, path, text: '{not json', contentType: 'application/json' },
    { name: label + ' | json null', method, path, text: 'null', contentType: 'application/json' },
    { name: label + ' | json array', method, path, text: '[]', contentType: 'application/json' },
    { name: label + ' | valid json as text/plain', method, path, text: t, contentType: 'text/plain' },
    { name: label + ' | valid json no content-type', method, path, bytes: Buffer.from(t), },
  ];
};
const bodyEdges: Scenario = {
  name: 'body-parsing-edges',
  isolated: true,
  steps: [
    ...edgeCases('login', 'POST', '/auth/login', { identifier: 'admin', password: 'Admin@123' }),
    ...edgeCases('users create', 'POST', '/users', { username: 'edge1', email: 'edge1@x.y' }),
    ...edgeCases('users patch', 'PATCH', '/users/2', { fullName: 'Edge' }),
    ...edgeCases('channels create', 'POST', '/channels', { name: 'E', type: 'WHATSAPP', accountId: 'E1', apiKeyEnv: 'E' }),
    ...edgeCases('channels patch', 'PATCH', '/channels/2', { name: 'E2' }),
    ...edgeCases('receive-channels create', 'POST', '/receive-channels', { name: 'E', type: 'TELEGRAM', accountId: 'E1', apiKeyEnv: 'E' }),
    ...edgeCases('receive-channels patch', 'PATCH', '/receive-channels/2', { name: 'E2' }),
    ...edgeCases('customers create', 'POST', '/customers', { name: 'Edge', whatsappPhone: '84900000777' }),
    ...edgeCases('customers patch', 'PATCH', '/customers/2', { name: 'Edge', whatsappPhone: '919876000002' }),
    ...edgeCases('customers bulk-delete', 'POST', '/customers/bulk-delete', { ids: [20] }),
    ...edgeCases('customers import', 'POST', '/customers/import', { rows: [{ name: 'I', whatsappPhone: '84900000999' }] }),
    ...edgeCases('quotations create', 'POST', '/quotations', { code: 'E-1' }),
    ...edgeCases('quotations patch', 'PATCH', '/quotations/3', { title: 'E' }),
    ...edgeCases('quotation items put', 'PUT', '/quotations/1/items', { items: [{ product: 'x', quantity: 2, price: 3 }] }),
    ...edgeCases('quotation template create', 'POST', '/quotations/1/templates', { name: 'E' }),
    ...edgeCases('templates create', 'POST', '/templates', { name: 'E' }),
    ...edgeCases('templates patch', 'PATCH', '/templates/6', { name: 'E' }),
    ...edgeCases('template customer create', 'POST', '/templates/4/customers', { name: 'E', whatsappPhone: '84900000778' }),
    ...edgeCases('template customers link', 'POST', '/templates/4/customers/link', { customerIds: [20] }),
    ...edgeCases('template customers unlink', 'POST', '/templates/1/customers/unlink', { customerIds: [1] }),
    ...edgeCases('send preview', 'POST', '/send/preview', { templateId: 1 }),
    ...edgeCases('send confirm', 'POST', '/send/confirm', { batchId: 3 }),
    ...edgeCases('send cancel', 'POST', '/send/cancel', { batchId: 3 }),
    ...edgeCases('zalo test', 'POST', '/zalo/test', { userId: 'u1' }),
    ...edgeCases('zalo oauth start', 'POST', '/zalo/oauth/start', {}),
    ...edgeCases('zalo oauth exchange', 'POST', '/zalo/oauth/exchange', { code: 'x' }),
    { name: 'template image upload | control image/png', method: 'POST', path: '/templates/1/image', bytes: PNG, contentType: 'image/png' },
    { name: 'template image upload | no content-type (Next defaults image/png)', method: 'POST', path: '/templates/1/image', bytes: PNG },
    { name: 'template image upload | image/png + empty body', method: 'POST', path: '/templates/1/image', bytes: Buffer.alloc(0), contentType: 'image/png' },
    { name: 'template image upload | application/octet-stream', method: 'POST', path: '/templates/1/image', bytes: PNG, contentType: 'application/octet-stream' },
    { name: 'template image upload | IMAGE/PNG uppercase', method: 'POST', path: '/templates/1/image', bytes: PNG, contentType: 'IMAGE/PNG' },
  ],
};

export const SCENARIOS: Scenario[] = [
  health,
  misc,
  auth,
  users,
  usersZalo,
  channels,
  receiveChannels,
  customersList,
  customersSearch,
  customersWrite,
  customersDelete,
  customersImport,
  quotations,
  quotationItems,
  templatesRead,
  templatesWrite,
  templatesCustomers,
  templatesImage,
  templateGuards,
  readonlyLists,
  waVerify,
  waEvents,
  waAutoReply,
  zaloWebhook,
  zaloAdmin,
  zaloAdminToken,
  zaloOauth,
  cronZaloToken,
  bodyEdges,
  sendFlow,
  sendCron,
];

export type { Vars };
