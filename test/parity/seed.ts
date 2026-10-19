import bcrypt from 'bcryptjs';
import { Db } from './db';

let ADMIN_HASH = '';
let SALE_HASH = '';
let LOCK_HASH = '';

/** ISO cách đây `ms` (cột timestamp(6) không múi giờ: Postgres bỏ qua hậu tố Z -> lưu đúng giờ UTC). */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export async function prepareHashes(): Promise<void> {
  ADMIN_HASH = await bcrypt.hash('Admin@123', 4);
  SALE_HASH = await bcrypt.hash('Sale@123', 4);
  LOCK_HASH = await bcrypt.hash('Lock@123', 4);
}

const NAMES = ['Nguyễn Văn An', 'Trần Thị Bích', 'Lê Hoàng', 'Phạm Quốc Bảo', 'Rajesh Kumar', 'Ahmed Khan', 'Tanaka Hiro', 'Kim Min-jun'];
const pad = (n: number, w: number) => String(n).padStart(w, '0');

type Row = Record<string, unknown>;
function buildCustomers(): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= 40; i++) {
    let market: string | null;
    let wa: string;
    let phoneType: string | null = 'MOBILE';
    if (i <= 2) { market = 'INDIA'; wa = '9198' + (76000000 + i); }
    else if (i === 3) { market = 'UAE'; wa = '971501234003'; }
    else if (i >= 4 && i <= 6) { market = 'VIETNAM'; wa = '849123456' + pad(i, 2); }
    else if (i === 7) { market = 'JAPAN'; wa = '819012340007'; }
    else if (i === 8) { market = 'KOREA'; wa = '821012340008'; }
    else if (i === 9) { market = 'USA'; wa = '12025550109'; phoneType = 'AMBIGUOUS'; }
    else if (i === 10) { market = null; wa = '849000000010'; phoneType = 'UNKNOWN'; }
    else if (i <= 16) { market = 'VIETNAM'; wa = '842838' + pad(i, 6); phoneType = 'FIXED_LINE'; }
    else if (i <= 24) { market = 'INDIA'; wa = '9198' + (76000000 + i); }
    else if (i <= 30) { market = 'UAE'; wa = '97150' + (1234000 + i); }
    else if (i <= 34) { market = 'JAPAN'; wa = '8190' + (12340000 + i); }
    else if (i <= 37) { market = 'KOREA'; wa = '8210' + (12340000 + i); }
    else if (i === 38) { market = 'USA'; wa = '12025550138'; phoneType = 'AMBIGUOUS'; }
    else if (i === 39) { market = null; wa = '849000000039'; phoneType = 'UNKNOWN'; }
    else { market = 'vietnam'; wa = '84912345640'; } // market viết thường để test lọc insensitive
    if (i === 31) wa = '971501234030'; // trùng whatsapp của khách 30 (DB cho phép trùng)
    rows.push({
      id: i,
      name: `${NAMES[i % 8]} ${i}`,
      company: i % 3 === 0 ? null : `ACME ${i} Trading`,
      phone: i === 21 ? '919876000001' : i % 5 === 0 ? '8428' + pad(i, 7) : null, // khách 21: phone trùng whatsapp khách 1
      whatsapp_phone: wa,
      email: i % 2 === 0 ? `c${i}@example.com` : null,
      address: i % 7 === 0 ? `Địa chỉ ${i}` : null,
      market,
      status: i === 7 || i === 13 ? 'INACTIVE' : 'ACTIVE',
      receive_quotation: i !== 8 && i !== 26,
      note: i % 9 === 0 ? `Ghi chú ${i}` : null,
      phone_type: phoneType,
      wa_status: i === 9 ? 'NO_WHATSAPP' : null,
      created_at: ago((50 - i) * HOUR),
    });
  }
  return rows;
}

export async function seed(db: Db): Promise<void> {
  await db.insert('users', [
    { id: 1, username: 'admin', email: 'admin@parity.test', password_hash: ADMIN_HASH, full_name: 'Quản trị', is_active: true, created_at: ago(5 * DAY) },
    { id: 2, username: 'sale1', email: 'sale1@parity.test', password_hash: SALE_HASH, full_name: 'Nguyễn Sale', is_active: true, created_at: ago(4 * DAY) },
    { id: 3, username: 'locked', email: 'locked@parity.test', password_hash: LOCK_HASH, full_name: null, is_active: false, created_at: ago(3 * DAY) },
    { id: 4, username: 'nopass', email: 'nopass@parity.test', password_hash: 'SET_BY_ADMIN', full_name: 'Chưa đặt MK', is_active: true, created_at: ago(2 * DAY) },
  ]);
  await db.insert('roles', [
    { id: 1, code: 'ADMIN', name: 'Quản trị viên', description: 'Toàn quyền', created_at: ago(9 * DAY) },
    { id: 2, code: 'SALE', name: 'Nhân viên kinh doanh', description: null, created_at: ago(9 * DAY) },
  ]);
  await db.insert('user_roles', [
    { user_id: 1, role_id: 1, assigned_at: ago(5 * DAY) },
    { user_id: 2, role_id: 2, assigned_at: ago(4 * DAY) },
  ]);
  await db.insert('categories', [{ id: 1, name: 'Trái cây', slug: 'trai-cay', created_at: ago(9 * DAY) }]);

  await db.insert('channels', [
    { id: 1, name: 'WA Main', type: 'WHATSAPP', account_id: 'PHONEID-1', api_key_env: 'WHATSAPP_TOKEN_MAIN', is_active: true, note: 'Kênh WA chính', created_at: ago(9 * DAY) },
    { id: 2, name: 'TG Bot', type: 'TELEGRAM', account_id: 'BOT-1', api_key_env: 'TELEGRAM_BOT_TOKEN_MAIN', is_active: true, note: null, created_at: ago(8 * DAY) },
    { id: 3, name: 'Zalo OA', type: 'ZALO', account_id: 'OA-1', api_key_env: 'ZALO_OA_TOKEN_MAIN', is_active: false, note: null, created_at: ago(7 * DAY) },
  ]);
  await db.insert('receive_channels', [
    { id: 1, name: 'WA AGO nhận', type: 'WHATSAPP', account_id: 'PHONEID-1', api_key_env: 'WHATSAPP_VERIFY_TOKEN', is_active: true, note: null, created_at: ago(9 * DAY) },
    { id: 2, name: 'Sếp Telegram', type: 'TELEGRAM', account_id: '99999', api_key_env: 'TELEGRAM_BOT_TOKEN_MAIN', is_active: true, note: 'báo sếp', created_at: ago(8 * DAY) },
    { id: 3, name: 'Zalo — Nguyễn Sale', type: 'ZALO', account_id: 'zuid-sale', api_key_env: 'ZALO_OA_TOKEN_MAIN', is_active: true, note: 'Kích hoạt bởi sale1', created_at: ago(7 * DAY) },
    { id: 4, name: 'Zalo cũ', type: 'ZALO', account_id: 'zuid-old', api_key_env: 'ZALO_OA_TOKEN_MAIN', is_active: false, note: null, created_at: ago(6 * DAY) },
  ]);

  await db.insert('quotations', [
    { id: 1, code: 'BG-2026-0001', title: 'Báo giá Sầu riêng', total_amount: '15000.00', currency: 'USD', status: 'DRAFT', market: 'INDIA', issued_date: '2026-08-01', valid_until: '2026-12-31', created_at: ago(6 * DAY) },
    { id: 2, code: 'BG-2026-0002', title: 'Báo giá Thanh long', total_amount: '800000.50', currency: 'VND', status: 'SENT', market: null, issued_date: null, valid_until: '2026-11-30', created_at: ago(5 * DAY) },
    { id: 3, code: 'BG-2026-0003', title: null, total_amount: '0', currency: 'VND', status: 'DRAFT', market: 'UAE', issued_date: null, valid_until: null, created_at: ago(4 * DAY) },
  ]);
  await db.insert('quotation_items', [
    { id: 1, quotation_id: 1, no: 1, product: 'Sầu riêng Monthong', packing: '20kg/thùng', unit: 'kg', quantity: '1000.000', price: '8.50', note: 'Loại A', created_at: ago(6 * DAY) },
    { id: 2, quotation_id: 1, no: 2, product: 'Sầu riêng Ri6', packing: null, unit: 'kg', quantity: '500.500', price: '7.25', note: null, created_at: ago(6 * DAY) },
    { id: 3, quotation_id: 1, no: 3, product: 'Măng cụt', packing: '10kg', unit: 'kg', quantity: '200', price: '4', note: null, created_at: ago(6 * DAY) },
    { id: 4, quotation_id: 2, no: 1, product: 'Thanh long ruột đỏ', packing: '5kg', unit: 'kg', quantity: '3000', price: '25000.50', note: null, created_at: ago(5 * DAY) },
    { id: 5, quotation_id: 2, no: 2, product: 'Thanh long ruột trắng', packing: '5kg', unit: 'kg', quantity: '1', price: '0', note: 'Mẫu', created_at: ago(5 * DAY) },
  ]);
  await db.insert('user_quotations', [{ user_id: 2, quotation_id: 1, role_in_quotation: 'OWNER', assigned_at: ago(5 * DAY) }]);

  await db.insert('templates', [
    { id: 1, quotation_id: 1, channel_id: 1, name: 'Sầu riêng 2026', icon: '🍈', subject: 'Sầu riêng', body: 'Kính gửi {khách hàng}, báo giá {mã} tổng {giá}.', wa_template_name: 'baogia_saurieng', wa_language: 'en', wa_category: 'MARKETING', wa_image: true, send_as_text: false, wa_body_params: 'customer_name={khách hàng}', wa_flow: true, auto_reply: false, is_active: true, created_at: ago(9 * HOUR) },
    { id: 2, quotation_id: 1, channel_id: 2, name: 'Sầu riêng Telegram', icon: null, subject: 'Sầu riêng TG', body: 'Chào {khách hàng}: {mã}', wa_template_name: null, wa_language: 'vi', wa_category: null, wa_image: false, send_as_text: false, wa_body_params: null, wa_flow: false, auto_reply: false, is_active: true, created_at: ago(8 * HOUR) },
    { id: 3, quotation_id: 2, channel_id: 1, name: 'Thanh long VN', icon: null, subject: 'Thanh long', body: 'Hi {khách hàng}', wa_template_name: 'baogia_thanhlong', wa_language: 'vi', wa_category: 'MARKETING', wa_image: true, send_as_text: false, wa_body_params: null, wa_flow: true, auto_reply: false, is_active: true, created_at: ago(7 * HOUR) },
    { id: 4, quotation_id: null, channel_id: 1, name: 'Trả lời tự động', icon: null, subject: null, body: 'Cảm ơn {khách hàng}', wa_template_name: 'tra_loi_auto', wa_language: 'vi', wa_category: 'UTILITY', wa_image: false, send_as_text: false, wa_body_params: 'customer_name={khách hàng}', wa_flow: true, auto_reply: false, is_active: true, created_at: ago(6 * HOUR) },
    { id: 5, quotation_id: null, channel_id: null, name: 'Mẫu kho', icon: null, subject: 'Kho', body: 'Nội dung kho', wa_template_name: null, wa_language: 'vi', wa_category: null, wa_image: false, send_as_text: true, wa_body_params: null, wa_flow: false, auto_reply: false, is_active: true, created_at: ago(5 * HOUR) },
    { id: 6, quotation_id: 3, channel_id: 1, name: 'Rỗng khách', icon: null, subject: null, body: null, wa_template_name: null, wa_language: 'vi', wa_category: null, wa_image: false, send_as_text: false, wa_body_params: null, wa_flow: false, auto_reply: false, is_active: false, created_at: ago(4 * HOUR) },
  ]);

  await db.insert('customers', buildCustomers());
  await db.insert('template_customers', [
    ...[1, 2, 3, 4, 7, 8, 9].map((c) => ({ template_id: 1, customer_id: c, created_at: ago(3 * HOUR) })),
    ...[1, 2].map((c) => ({ template_id: 2, customer_id: c, created_at: ago(3 * HOUR) })),
    ...[5, 6].map((c) => ({ template_id: 3, customer_id: c, created_at: ago(3 * HOUR) })),
  ]);
  await db.insert('audit_logs', [
    { id: 1, customer_id: 40, action: 'UPDATE', old_value: JSON.stringify({ a: 1 }), new_value: JSON.stringify({ a: 2 }), changed_by: 1, changed_at: ago(DAY) },
  ]);

  await db.insert('send_batches', [
    { id: 1, code: 'BG20260101000001', quotation_id: 1, template_id: 1, channel_id: 1, created_by: 1, recipient_count: 3, media_id: null, status: 'PARTIAL_FAILED', note: 'Đã gửi 2, lỗi 1', created_at: ago(5 * DAY) },
    { id: 2, code: 'BG20260101000002', quotation_id: 2, template_id: 3, channel_id: 1, created_by: 2, recipient_count: 2, media_id: null, status: 'QUEUED', note: 'Đã đưa 2 khách vào hàng đợi', created_at: ago(2 * HOUR) },
    { id: 3, code: 'BG20260101000003', quotation_id: 1, template_id: 2, channel_id: null, created_by: null, recipient_count: 2, media_id: null, status: 'PREVIEW', note: 'Đã tạo lệnh preview', created_at: ago(3 * DAY) },
  ]);
  await db.insert('send_jobs', [
    { id: 1, batch_id: 1, customer_id: 1, to_name: 'Khách 1', to_phone: '919876000001', channel: 'WHATSAPP', message: 'msg1', status: 'SENT', message_id: 'wamid.PARITY001', error: null, retry_count: 0, sent_at: ago(2 * DAY), created_at: ago(5 * DAY) },
    { id: 2, batch_id: 1, customer_id: 2, to_name: 'Khách 2', to_phone: '919876000002', channel: 'WHATSAPP', message: 'msg2', status: 'DELIVERED', message_id: 'wamid.PARITY002', error: null, retry_count: 0, sent_at: ago(2 * DAY), created_at: ago(5 * DAY) },
    { id: 3, batch_id: 1, customer_id: 3, to_name: 'Khách 3', to_phone: '971501234003', channel: 'WHATSAPP', message: 'msg3', status: 'FAILED', message_id: null, error: 'Graph API lỗi 400', retry_count: 3, sent_at: null, created_at: ago(5 * DAY) },
    { id: 4, batch_id: 2, customer_id: 5, to_name: 'Khách 5', to_phone: '84912345605', channel: 'WHATSAPP', message: 'msg5', status: 'QUEUED', message_id: null, error: null, retry_count: 0, sent_at: null, created_at: ago(2 * HOUR) },
    { id: 5, batch_id: 2, customer_id: 6, to_name: 'Khách 6', to_phone: '84912345606', channel: 'WHATSAPP', message: 'msg6', status: 'HOLD', message_id: null, error: null, retry_count: 0, sent_at: null, created_at: ago(40 * DAY) },
  ]);

  await db.insert('inbound_messages', [
    { id: 1, wa_message_id: 'wamid.IN001', from_phone: '919876000001', from_name: 'Khách 1', customer_id: 1, receive_channel_id: 1, channel: 'WHATSAPP', kind: 'message', type: 'text', text: 'Cho tôi xin giá', raw: JSON.stringify({ id: 'wamid.IN001' }), auto_replied: false, received_at: ago(2 * HOUR) },
    { id: 2, wa_message_id: 'zalo-follow-zuid-100-1', from_phone: 'zuid-100', from_name: 'Zalo Khách', customer_id: null, receive_channel_id: null, channel: 'ZALO', kind: 'message', type: 'follow', text: '[Đã quan tâm OA]', raw: JSON.stringify({ event_name: 'follow' }), auto_replied: false, received_at: ago(3 * HOUR) },
    { id: 3, wa_message_id: 'wamid.IN003', from_phone: '84912345604', from_name: null, customer_id: 4, receive_channel_id: 1, channel: 'WHATSAPP', kind: 'flow_response', type: 'interactive', text: JSON.stringify({ Name_of_product: 'Sầu riêng', Quatity: '5' }), raw: null, auto_replied: true, received_at: ago(5 * DAY) },
  ]);

  await db.insert('activity_logs', [
    { id: 1, user_id: 1, actor_name: 'Quản trị', action: 'DANG_NHAP', target: 'admin', result: 'SUCCESS', note: null, created_at: ago(1 * HOUR) },
    { id: 2, user_id: null, actor_name: null, action: 'GUI_WHATSAPP_QUEUE', target: 'BG20260101000001', result: 'SUCCESS', note: 'sent 2', created_at: ago(5 * DAY) },
    { id: 3, user_id: null, actor_name: null, action: 'GUI_WHATSAPP_QUEUE', target: 'BG20260101000001', result: 'FAILED', note: 'sent 0', created_at: ago(5 * DAY - HOUR) },
    { id: 4, user_id: 2, actor_name: 'Nguyễn Sale', action: 'KHACH_HANG_TAO', target: 'Khách', result: 'SUCCESS', note: 'tên: Khách', created_at: ago(10 * DAY) },
    { id: 5, user_id: 1, actor_name: 'Quản trị', action: 'KHACH_HANG_XOA', target: 'Cũ', result: 'SUCCESS', note: null, created_at: ago(40 * DAY) },
  ]);

  await db.insert('quotation_template_sends', [
    { id: 1, quotation_id: 1, template_id: 1, sent_to: 'x@y.z', sent_at: ago(DAY), status: 'SENT', note: null, created_at: ago(DAY) },
  ]);
  await db.insert('zalo_user_bindings', [
    { user_id: 2, zalo_user_id: 'zuid-sale', zalo_name: 'Sale Zalo', status: 'ACTIVE', linked_at: ago(3 * DAY) },
  ]);
  await db.insert('zalo_link_requests', [{ user_id: 3, code: '111111', expires_at: ago(HOUR), created_at: ago(2 * HOUR) }]);
  await db.insert('app_settings', [{ key: 'zalo_oa_name', value: 'AGO Fruit OA', updated_at: ago(DAY) }]);
  await db.fixSequences();
}

/** Thêm dòng token Zalo HẾT HẠN (giả): refresh/status chạy mà KHÔNG chạm mạng (thiếu ZALO_SECRET_KEY nên callOAuth ném lỗi trước fetch). */
export async function seedExpiredZaloToken(db: Db): Promise<void> {
  await db.insert('zalo_oa_tokens', [
    { oa_id: 'OA-1', access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_at: ago(3 * HOUR), created_at: ago(2 * DAY), updated_at: ago(3 * HOUR) },
  ]);
}

export async function seedPkce(db: Db, state: string): Promise<void> {
  await db.insert('app_settings', [
    { key: 'zalo_pkce_verifier', value: 'fake-verifier', updated_at: ago(MIN) },
    { key: 'zalo_pkce_state', value: state, updated_at: ago(MIN) },
    { key: 'zalo_pkce_at', value: ago(MIN), updated_at: ago(MIN) },
  ]);
}
