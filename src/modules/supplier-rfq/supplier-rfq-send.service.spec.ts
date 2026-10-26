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
  image: { rfqId: 1n },
};
const sup = (id: bigint, zaloUserId: string | null, status = 'ACTIVE') => ({
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
    countTestInvitationsSince: jest.fn().mockResolvedValue(0),
  };
  const zalo = { sendRfqMessage: jest.fn() };
  const audit = { audit: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupplierRfqSendService(
    repo as unknown as SupplierRfqRepository,
    zalo as unknown as ZaloClient,
    audit as unknown as AuditService,
  );
  const req = { headers: {}, protocol: 'http', get: () => 'localhost' } as unknown as Request;
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
      error: 'Nhà cung cấp chưa có Zalo user_id.',
    });
    expect(t.repo.createInvitation).not.toHaveBeenCalled();
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
    expect(t.repo.markSentIfDraft).not.toHaveBeenCalled();
  });

  it('gửi thật: payload list tới đúng user_id, link theo APP_BASE_URL, chỉ lưu hash token', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111222')] });
    t.zalo.sendRfqMessage.mockResolvedValue({ ok: true, resp: { error: 0 }, messageId: 'M1' });
    const r = await t.svc.send(t.req, '1', { supplierIds: [5] });
    expect(r.results[0]).toMatchObject({ ok: true, status: 'SENT' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
    const [uid, msg] = t.zalo.sendRfqMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(uid).toBe('111222');
    const json = JSON.stringify(msg);
    expect(json).toContain('"template_type":"list"');
    expect(json).toContain('http://app.test/ncc/');
    expect(json).toContain('http://app.test/api/supplier-rfqs/1/image');
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

  it('list lỗi -> thử text; list+text lỗi -> FAILED kèm lỗi cả hai; lỗi một NCC không dừng NCC khác', async () => {
    realSend();
    const t = setup({ suppliers: [sup(5n, '111'), sup(6n, '222')] });
    t.zalo.sendRfqMessage.mockImplementation((uid: string, msg: Record<string, unknown>) => {
      const isList = 'attachment' in msg;
      if (uid === '111') {
        return Promise.resolve(isList ? { ok: false, error: 'list sai khuôn' } : { ok: true });
      }
      return Promise.resolve({ ok: false, error: isList ? 'L-lỗi' : 'T-lỗi' });
    });
    const r = await t.svc.send(t.req, '1', { supplierIds: ['5', '6'] });
    expect(r.results[0]).toMatchObject({ supplierId: '5', ok: true, status: 'SENT' });
    expect(r.results[1]).toMatchObject({ supplierId: '6', ok: false, status: 'FAILED' });
    expect(r.results[1].error).toContain('L-lỗi');
    expect(r.results[1].error).toContain('T-lỗi');
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
    const r = await t.svc.testSend(t.req, '1', { zaloUserId: '999' });
    expect(t.zalo.sendRfqMessage).toHaveBeenCalledTimes(1);
    expect((t.zalo.sendRfqMessage.mock.calls[0] as [string])[0]).toBe('999');
    expect(r).toMatchObject({ ok: true, mode: 'list', zalo: { error: 0, message: 'Success' } });
    expect(r.link).toMatch(/^http:\/\/app\.test\/ncc\/[A-Za-z0-9_-]{43}$/);
    expect(t.repo.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ isTest: true, supplierId: null }),
    );
    expect(t.invs[0]).toMatchObject({ status: 'SENT' });
  });

  it('test-send: list lỗi, text ổn -> ok mode=text kèm listError; cả hai lỗi -> ok=false + error', async () => {
    process.env.APP_BASE_URL = 'http://app.test';
    const a = setup();
    a.zalo.sendRfqMessage.mockImplementation((_u: string, m: Record<string, unknown>) =>
      Promise.resolve(
        'attachment' in m
          ? { ok: false, error: 'bad list', resp: { error: -1 } }
          : { ok: true, resp: { error: 0 } },
      ),
    );
    const ra = await a.svc.testSend(a.req, '1', { zaloUserId: '9' });
    expect(ra).toMatchObject({ ok: true, mode: 'text', listError: 'bad list', zalo: { error: 0 } });

    const b = setup();
    b.zalo.sendRfqMessage.mockResolvedValue({ ok: false, error: 'x', resp: { error: -213 } });
    const rb = await b.svc.testSend(b.req, '1', { zaloUserId: '9' });
    expect(rb).toMatchObject({ ok: false, mode: 'text', zalo: { error: -213 } });
    expect(rb.error).toContain('Dạng list');
    expect(b.invs[0].status).toBe('FAILED');
  });

  it('thiếu APP_BASE_URL -> send và test-send báo lỗi, không gọi Zalo, không tạo lời mời', async () => {
    process.env.SEND_DRY_RUN = 'false';
    delete process.env.APP_BASE_URL;
    const t = setup({ suppliers: [sup(5n, '111')] });
    const msg = 'Chưa cấu hình APP_BASE_URL (domain FE) — không thể tạo link báo giá.';
    await expect(t.svc.send(t.req, '1', { supplierIds: ['5'] })).rejects.toThrow(msg);
    await expect(t.svc.testSend(t.req, '1', { zaloUserId: '9' })).rejects.toThrow(msg);
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
    await expect(t.svc.testSend(t.req, '1', { zaloUserId: '9' })).rejects.toMatchObject({
      status: 429,
      response: { error: 'Đã nhắn thử quá nhiều lần, thử lại sau.' },
    });
    expect(t.zalo.sendRfqMessage).not.toHaveBeenCalled();
  });
});
