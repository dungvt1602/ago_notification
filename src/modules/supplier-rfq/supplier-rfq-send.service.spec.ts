import type { Request } from 'express';
import type { AuditService } from '@common/audit/audit.service';
import type { ZaloClient } from '../zalo/zalo.client';
import { SupplierRfqSendService } from './supplier-rfq-send.service';
import type { SupplierRfqRepository } from './supplier-rfq.repository';

type Inv = {
  id: bigint;
  rfqId: bigint;
  supplierId: bigint | null;
  status: string;
  tokenHash: string;
  messageId?: string | null;
  expiresAt?: Date;
};

const rfq = {
  id: 1n,
  code: 'RFQ-2026-0001',
  title: 'Xoài',
  note: null,
  status: 'DRAFT',
  currency: 'VND',
  deadline: null,
  items: [{ id: 11n, no: 1 }],
  image: null,
};
const rfqImg = { ...rfq, image: { rfqId: 1n } };
const sup = (id: bigint, zaloUserId: string | null, status = 'ACTIVE', phone: string | null = null) => ({
  phone,
  id,
  name: `NCC ${id}`,
  zaloUserId,
  status,
});

function setup(
  opts: { invitations?: Inv[]; suppliers?: ReturnType<typeof sup>[]; rfqRow?: object | null } = {},
) {
  const invs = [...(opts.invitations ?? [])];
  let nextId = 100n;
  const repo = {
    findWithItems: jest.fn().mockResolvedValue(opts.rfqRow === undefined ? rfq : opts.rfqRow),
    findSuppliersByIds: jest.fn().mockResolvedValue(opts.suppliers ?? []),
    findInvitation: jest.fn((rfqId: bigint, supplierId: bigint) =>
      Promise.resolve(
        // Bản sao như Prisma thật (không dùng chung object với "DB" giả).
        ((x) => (x ? { ...x } : null))(invs.find((i) => i.rfqId === rfqId && i.supplierId === supplierId)),
      ),
    ),
    createInvitation: jest.fn((d: Omit<Inv, 'id'>) => {
      const row = { ...d, id: nextId++ } as Inv;
      invs.push(row);
      return Promise.resolve(row);
    }),
    updateInvitation: jest.fn((id: bigint, d: Partial<Inv>) => {
      Object.assign(invs.find((i) => i.id === id) as Inv, d);
      return Promise.resolve();
    }),
    markSentIfDraft: jest.fn().mockResolvedValue({ count: 1 }),
    setSupplierZaloUserId: jest.fn().mockResolvedValue({ count: 1 }),
    countTestInvitationsSince: jest.fn().mockResolvedValue(0),
  };
  const zalo = {
    sendRfqMessage: jest.fn(),
    resolveZaloUserId: jest.fn((x: string) => Promise.resolve(x)),
  };
  const audit = { audit: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupplierRfqSendService(
    repo as unknown as SupplierRfqRepository,
    zalo as unknown as ZaloClient,
    audit as unknown as AuditService,
  );
  const req = { headers: {}, protocol: 'http', get: () => 'localhost' } as unknown as Request;
  svc.paceMs = 0; // test không chờ thật; test giãn nhịp tự đặt lại
  return { svc, repo, zalo, audit, req, invs };
}

describe('SupplierRfqSendService', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });
  const realSend = () => {
    process.env.SEND_DRY_RUN = 'false';
    process.env.APP_BASE_URL = 'http://app.test';
  };

  it('dry-run: không gọi Zalo, message_id DRYRUN-, lời mời SENT, RFQ DRAFT->SENT', async () => {
    process.env.SEND_DRY_RUN = 'true';
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup({ suppliers: [sup(5n, '111')] });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
    expect(r.results).toEqual([
      expect.objectContaining({
        supplierId: '5',
        ok: true,
        status: 'SENT',
        invitationId: expect.any(String),
      }),
    ]);
    const patch = t.repo.updateInvitation.mock.calls[0][1] as { messageId: string; status: string };
    expect(patch.messageId).toMatch(/^DRYRUN-/);
    expect(patch.status).toBe('SENT');
    expect(t.repo.markSentIfDraft).toHaveBeenCalledWith(1n);
  });

  it('NCC thiếu zaloUserId -> ok=false, không tạo lời mời, không gọi Zalo, RFQ vẫn DRAFT', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, null)] });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(r.results[0]).toMatchObject({
      ok: false,
      error: 'Nhà cung cấp chưa có SĐT hoặc Zalo user_id.',
    });
    expect(t.repo.createInvitation).not.toHaveBeenCalled();
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
    expect(t.repo.markSentIfDraft).not.toHaveBeenCalled();
  });

  it('gửi thật: ảnh rồi tin có nút tới đúng user_id, link theo APP_BASE_URL, chỉ lưu hash token', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111222')], rfqRow: rfqImg });
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true, resp: { error: 0 }, messageId: 'M1' });
    const r = await t.svc.send(t.req, '1', { supplierIds: [5] });
    expect(r.results[0]).toMatchObject({ ok: true, status: 'SENT' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(2);
    const [imgUid, imgMsg] = t.zalo.sendRfqMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(imgUid).toBe('111222');
    expect(JSON.stringify(imgMsg)).toContain('"media_type":"image"');
    expect(JSON.stringify(imgMsg)).toContain('http://app.test/api/supplier-rfqs/1/image');
    const [uid, msg] = t.zalo.sendRfqMessage.mock.calls[1] as [string, Record<string, unknown>];
    expect(uid).toBe('111222');
    const json = JSON.stringify(msg);
    expect(json).toContain('"buttons"');
    expect(json).toContain('http://app.test/ncc/');
    const token = /\/ncc\/([A-Za-z0-9_-]{43})/.exec(json)?.[1] as string;
    const created = t.repo.createInvitation.mock.calls[0][0] as { tokenHash: string };
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenHash).not.toContain(token);
    expect(t.invs[0].messageId).toBe('M1');
  });

  it('đã gửi trước đó và không resend -> bỏ qua, giữ trạng thái, không gọi Zalo', async () => {
    realSend();
    const t = setup({
      suppliers: [sup(5n, '111')],
      invitations: [{ id: 7n, rfqId: 1n, supplierId: 5n, status: 'VIEWED', tokenHash: 'h' }],
    });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(r.results[0]).toMatchObject({
      ok: true,
      status: 'VIEWED',
      error: 'Đã gửi trước đó.',
      invitationId: '7',
    });
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
    expect(t.repo.markSentIfDraft).not.toHaveBeenCalled();
  });

  it('resend: gửi lại, đổi token, giữ nguyên VIEWED/SUBMITTED', async () => {
    realSend();
    const t = setup({
      suppliers: [sup(5n, '111')],
      invitations: [{ id: 7n, rfqId: 1n, supplierId: 5n, status: 'SUBMITTED', tokenHash: 'old' }],
    });
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'], resend: true });
    expect(r.results[0]).toMatchObject({ ok: true, status: 'SUBMITTED', invitationId: '7' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
    expect(t.invs[0].tokenHash).not.toBe('old');
  });

  it('resend lỗi: giữ link cũ và trạng thái đã nộp, trả ok=false kèm lỗi', async () => {
    realSend();
    const t = setup({
      suppliers: [sup(5n, '111')],
      invitations: [{ id: 7n, rfqId: 1n, supplierId: 5n, status: 'SUBMITTED', tokenHash: 'old' }],
    });
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: false, error: 'boom' });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'], resend: true });
    expect(r.results[0]).toMatchObject({ ok: false, status: 'SUBMITTED' });
    expect(t.invs[0].tokenHash).toBe('old');
  });

  it('nút bị từ chối (lỗi nghiệp vụ) -> thử text; cả hai lỗi -> FAILED; lỗi một NCC không dừng NCC khác', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111'), sup(6n, '222')] });
    t.zalo.sendRfqMessage.mockImplementation((uid: string, msg: Record<string, unknown>) => {
      const isButtons = 'attachment' in msg;
      if (uid === '111') {
        return Promise.resolve(isButtons ? { ok: false, code: -1, error: 'nút sai' } : { ok: true });
      }
      return Promise.resolve({ ok: false, code: -1, error: isButtons ? 'L-lỗi' : 'T-lỗi' });
    });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5', '6'] });
    expect(r.results[0]).toMatchObject({ supplierId: '5', ok: true, status: 'SENT' });
    expect(r.results[1]).toMatchObject({ supplierId: '6', ok: false, status: 'FAILED' });
    expect(r.results[1].error).toBe('T-lỗi');
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(4);
    expect(t.repo.markSentIfDraft).toHaveBeenCalledTimes(1); // có 1 NCC thành công
  });

  it('RFQ đã đóng / chưa có mặt hàng / quá hạn / không tồn tại -> lỗi', async () => {
    realSend();
    await expect(
      setup({ rfqRow: { ...rfq, status: 'CLOSED' } }).svc.send(setup().req, '1', { supplierIds: ['5'] }),
    ).rejects.toThrow('Yêu cầu báo giá đã đóng.');
    await expect(
      setup({ rfqRow: { ...rfq, items: [] } }).svc.send(setup().req, '1', { supplierIds: ['5'] }),
    ).rejects.toThrow('chưa có mặt hàng');
    await expect(
      setup({ rfqRow: { ...rfq, deadline: new Date(Date.now() - 1000) } }).svc.send(setup().req, '1', {
        supplierIds: ['5'],
      }),
    ).rejects.toThrow('Đã quá hạn báo giá.');
    await expect(
      setup({ rfqRow: null }).svc.send(setup().req, '1', { supplierIds: ['5'] }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('test-send: luôn gọi Zalo kể cả dry-run, lời mời is_test không NCC, trả link + phản hồi Zalo', async () => {
    process.env.SEND_DRY_RUN = 'true';
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup();
    t.zalo.sendRfqMessage.mockResolvedValue({
      ok: true,
      resp: { error: 0, message: 'Success' },
      messageId: 'M9',
    });
    const r = await t.svc.testSend(t.req, '1', { zaloUserId: '999999' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
    expect((t.zalo.sendRfqMessage.mock.calls[0] as [string])[0]).toBe('999999');
    expect(r).toMatchObject({
      ok: true,
      mode: 'buttons',
      imageSent: false,
      zalo: { error: 0, message: 'Success' },
    });
    expect(r.link).toMatch(/^http:\/\/app\.test\/ncc\/[A-Za-z0-9_-]{43}$/);
    expect(t.repo.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ isTest: true, supplierId: null }),
    );
    expect(t.invs[0]).toMatchObject({ status: 'SENT' });
  });

  it('test-send: nút lỗi nghiệp vụ, text ổn -> ok mode=text kèm buttonError; cả hai lỗi -> ok=false + error cuối', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const a = setup();
    a.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve(
        'attachment' in m
          ? { ok: false, code: -1, error: 'bad button', resp: { error: -1 } }
          : { ok: true, resp: { error: 0 } },
      ),
    );
    const ra = await a.svc.testSend(a.req, '1', { zaloUserId: '999999' });
    expect(ra).toMatchObject({ ok: true, mode: 'text', buttonError: 'bad button', zalo: { error: 0 } });
    expect(ra).not.toHaveProperty('listError');

    const b = setup();
    b.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve({
        ok: false,
        code: -1,
        error: 'attachment' in m ? 'E-nút' : 'E-text',
        resp: { error: -1 },
      }),
    );
    const rb = await b.svc.testSend(b.req, '1', { zaloUserId: '999999' });
    expect(rb).toMatchObject({
      ok: false,
      mode: 'text',
      error: 'E-text',
      buttonError: 'E-nút',
      zalo: { error: -1 },
    });
    expect(b.invs[0].status).toBe('FAILED');
  });

  it('lỗi người nhận/hạn mức/token (-230...) -> KHÔNG rơi về text, trả lỗi thân thiện', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup();
    const msg = 'Người nhận không tương tác với OA quá 7 ngày — nhờ họ nhắn OA một tin rồi gửi lại.';
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: false, code: -230, error: msg, resp: { error: -230 } });
    const r = await t.svc.testSend(t.req, '1', { zaloUserId: '999999' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, mode: 'buttons', error: msg, zalo: { error: -230 } });
  });

  it('ảnh lỗi KHÔNG chặn tin báo giá: imageError được ghi, tin có nút vẫn gửi', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup({ rfqRow: rfqImg });
    t.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve(
        JSON.stringify(m).includes('media_type')
          ? { ok: false, code: -1, error: 'media sai' }
          : { ok: true, resp: { error: 0 } },
      ),
    );
    const r = await t.svc.testSend(t.req, '1', { zaloUserId: '999999' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, mode: 'buttons', imageSent: false, imageError: 'media sai' });
    const ok = setup({ rfqRow: rfqImg });
    ok.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    expect(await ok.svc.testSend(ok.req, '1', { zaloUserId: '999999' })).toMatchObject({ imageSent: true });
  });

  it('gửi hàng loạt: ảnh lỗi vẫn gửi được; dry-run không gửi ảnh', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111')], rfqRow: rfqImg });
    t.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve(
        JSON.stringify(m).includes('media_type') ? { ok: false, code: -1, error: 'x' } : { ok: true },
      ),
    );
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(r.results[0]).toMatchObject({ ok: true, status: 'SENT' });
    process.env.SEND_DRY_RUN = 'true';
    const d = setup({ suppliers: [sup(5n, '111')], rfqRow: rfqImg });
    await d.svc.send(d.req, '1', { supplierIds: ['5'] });
    expect(d.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });

  it('giãn nhịp: lượt gửi hàng loạt cách nhau >= paceMs; nhắn thử không chờ', async () => {
    const t = setup({ rfqRow: rfqImg });
    t.svc.paceMs = 80;
    t.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve(
        JSON.stringify(m).includes('buttons') ? { ok: false, code: -1, error: 'x' } : { ok: true },
      ),
    );
    const input = { code: 'C', title: 'T', deadline: null, itemCount: 1, link: 'l', imageUrl: 'u' };
    const t0 = Date.now();
    await t.svc.deliver('1', input, true); // ảnh + nút + text = 3 cuộc gọi
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    const t1 = Date.now();
    await t.svc.deliver('1', input, false);
    expect(Date.now() - t1).toBeLessThan(60);
  });

  it('thiếu APP_BASE_URL -> send và test-send báo lỗi, không gọi Zalo, không tạo lời mời', async () => {
    process.env.SEND_DRY_RUN = 'false';
    delete process.env.APP_BASE_URL;
    const t = setup({ suppliers: [sup(5n, '111')] });
    const msg = 'Chưa cấu hình APP_BASE_URL (domain FE) — không thể tạo link báo giá.';
    await expect(t.svc.send(t.req, '1', { supplierIds: ['5'] })).rejects.toThrow(msg);
    await expect(t.svc.testSend(t.req, '1', { zaloUserId: '999999' })).rejects.toThrow(msg);
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
    expect(t.repo.createInvitation).not.toHaveBeenCalled();
  });

  it('link luôn theo APP_BASE_URL, bỏ qua header Host/X-Forwarded-Host giả', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111')] });
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    const evil = { headers: { host: 'evil.test', 'x-forwarded-host': 'evil.test' }, get: () => 'evil.test' };
    await t.svc.send(evil as unknown as Request, '1', { supplierIds: ['5'] });
    const json = JSON.stringify(t.zalo.sendRfqMessage.mock.calls[0]);
    expect(json).toContain('http://app.test/ncc/');
    expect(json).not.toContain('evil.test');
  });

  it('NCC ngừng hoạt động bị bỏ qua với lỗi thân thiện', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111', 'INACTIVE')] });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(r.results[0]).toMatchObject({ ok: false, error: 'Nhà cung cấp đã ngừng hoạt động.' });
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });

  it('bấm đúp / gửi đồng thời cùng NCC: chỉ một lượt chạy, một token', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111')] });
    let release: () => void = () => undefined;
    t.zalo.sendRfqMessage.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true }))),
    );
    const p1 = t.svc.send(t.req, '1', { supplierIds: ['5'] });
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await t.svc.send(t.req, '1', { supplierIds: ['5'], resend: true });
    expect(r2.results[0]).toMatchObject({ ok: false, error: 'Đang gửi cho nhà cung cấp này, vui lòng chờ.' });
    release();
    await p1;
    expect(t.repo.createInvitation).toHaveBeenCalledTimes(1);
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
  });

  it('resend: hash mới được lưu TRƯỚC khi gọi Zalo; gửi lỗi thì khôi phục hash/hạn cũ', async () => {
    realSend();
    const oldExp = new Date('2030-01-01T00:00:00Z');
    const t = setup({
      suppliers: [sup(5n, '111')],
      invitations: [{ id: 7n, rfqId: 1n, supplierId: 5n, status: 'SENT', tokenHash: 'old' }],
    });
    t.invs[0].expiresAt = oldExp;
    let hashDuringSend = '';
    t.zalo.sendRfqMessage.mockImplementation(() => {
      hashDuringSend = t.invs[0].tokenHash;
      return Promise.resolve({ ok: false, error: 'boom' });
    });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'], resend: true });
    expect(hashDuringSend).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDuringSend).not.toBe('old');
    expect(r.results[0]).toMatchObject({ ok: false, status: 'SENT' });
    expect(t.invs[0].tokenHash).toBe('old');
    expect(t.invs[0].expiresAt).toBe(oldExp);
  });

  it('lỗi Prisma không lọt ra results[].error', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111')] });
    t.repo.createInvitation.mockRejectedValue(
      new Error('Invalid `prisma.supplierRfqInvitation.create()` invocation: ...'),
    );
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5'] });
    expect(r.results[0].error).toBe('Lỗi hệ thống khi gửi, thử lại sau.');
  });

  it('test-send: quá 20 lượt/giờ -> 429 và không gọi Zalo', async () => {
    realSend();
    const t = setup();
    t.repo.countTestInvitationsSince.mockResolvedValue(20);
    await expect(t.svc.testSend(t.req, '1', { zaloUserId: '999999' })).rejects.toMatchObject({
      status: 429,
      response: { error: 'Đã nhắn thử quá nhiều lần, thử lại sau.' },
    });
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });

  it('người nhận: user_id thắng SĐT; không có user_id thì dùng SĐT; không có cả hai -> lỗi', async () => {
    realSend();
    const t = setup({
      suppliers: [
        sup(5n, '111', 'ACTIVE', '0900000001'),
        sup(6n, null, 'ACTIVE', '0900000002'),
        sup(7n, null),
      ],
    });
    t.zalo.resolveZaloUserId.mockImplementation((x: string) =>
      Promise.resolve(x === '0900000002' ? 'RESOLVED6' : x),
    );
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5', '6', '7'] });
    expect(t.zalo.resolveZaloUserId.mock.calls.map((c) => c[0])).toEqual(['111', '0900000002']);
    expect(t.zalo.sendRfqMessage.mock.calls.map((c) => c[0])).toEqual(['111', 'RESOLVED6']);
    expect(r.results[2]).toMatchObject({ ok: false, error: 'Nhà cung cấp chưa có SĐT hoặc Zalo user_id.' });
  });

  it('SĐT có khoảng trắng/dấu được làm sạch trước khi tra; id tra được thì lưu vào NCC', async () => {
    realSend();
    const t = setup({ suppliers: [sup(6n, null, 'ACTIVE', '0900 000-002')] });
    t.zalo.resolveZaloUserId.mockResolvedValue('RESOLVED6');
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    await t.svc.send(t.req, '1', { supplierIds: ['6'] });
    expect(t.zalo.resolveZaloUserId).toHaveBeenCalledWith('0900000002');
    expect(t.repo.setSupplierZaloUserId).toHaveBeenCalledWith(6n, 'RESOLVED6');
  });

  it('lưu id lỗi không làm hỏng lượt gửi; NCC đã có user_id thì không ghi lại', async () => {
    realSend();
    const t = setup({ suppliers: [sup(6n, null, 'ACTIVE', '0900000002'), sup(5n, '111')] });
    t.zalo.resolveZaloUserId.mockImplementation((x: string) => Promise.resolve(x === '111' ? '111' : 'R6'));
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    t.repo.setSupplierZaloUserId.mockRejectedValue(new Error('db down'));
    const r = await t.svc.send(t.req, '1', { supplierIds: ['6', '5'] });
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(t.repo.setSupplierZaloUserId).toHaveBeenCalledTimes(1);
  });

  it('dry-run: không tra SĐT (không gọi mạng)', async () => {
    process.env.SEND_DRY_RUN = 'true';
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup({ suppliers: [sup(6n, null, 'ACTIVE', '0900000002')] });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['6'] });
    expect(r.results[0]).toMatchObject({ ok: true, status: 'SENT' });
    expect(t.zalo.resolveZaloUserId).not.toHaveBeenCalled();
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });

  it('tra SĐT lỗi: thông báo thân thiện, KHÔNG tạo/đổi lời mời và token cũ giữ nguyên', async () => {
    realSend();
    const t = setup({
      suppliers: [sup(6n, null, 'ACTIVE', '0900000002'), sup(5n, null, 'ACTIVE', '0900000003')],
      invitations: [{ id: 7n, rfqId: 1n, supplierId: 5n, status: 'SENT', tokenHash: 'old' }],
    });
    t.zalo.resolveZaloUserId.mockRejectedValue(
      new Error('SĐT 0900000002 chưa Quan tâm OA nên Zalo không cho nhắn.'),
    );
    const r = await t.svc.send(t.req, '1', { supplierIds: ['6', '5'], resend: true });
    expect(r.results[0]).toMatchObject({ ok: false, status: 'FAILED' });
    expect(r.results[0].error).toContain('chưa Quan tâm OA');
    expect(r.results[1]).toMatchObject({ ok: false, status: 'SENT', invitationId: '7' });
    expect(t.repo.createInvitation).not.toHaveBeenCalled();
    expect(t.repo.updateInvitation).not.toHaveBeenCalled();
    expect(t.invs[0].tokenHash).toBe('old');
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });

  it('test-send bằng SĐT: tra ra user_id, trả resolvedUserId, gửi tới id đã tra', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const t = setup();
    t.zalo.resolveZaloUserId.mockResolvedValue('RESOLVED9');
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true, resp: { error: 0 } });
    const r = await t.svc.testSend(t.req, '1', { zaloUserId: '0900 000 009' });
    expect(t.zalo.resolveZaloUserId).toHaveBeenCalledWith('0900000009');
    expect((t.zalo.sendRfqMessage.mock.calls[0] as [string])[0]).toBe('RESOLVED9');
    expect(r).toMatchObject({ ok: true, resolvedUserId: 'RESOLVED9' });
  });

  it('test-send bằng user_id: không có resolvedUserId; tra lỗi -> ok=false, không tạo lời mời', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const a = setup();
    a.zalo.sendRfqMessage.mockResolvedValue({ ok: true });
    expect(await a.svc.testSend(a.req, '1', { zaloUserId: '333333333333333333' })).not.toHaveProperty(
      'resolvedUserId',
    );
    const b = setup();
    b.zalo.resolveZaloUserId.mockRejectedValue(new Error('SĐT 0900000009 chưa Quan tâm OA'));
    const r = await b.svc.testSend(b.req, '1', { zaloUserId: '0900000009' });
    expect(r).toMatchObject({ ok: false, error: 'SĐT 0900000009 chưa Quan tâm OA' });
    expect(b.repo.createInvitation).not.toHaveBeenCalled();
    expect(b.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });
});
