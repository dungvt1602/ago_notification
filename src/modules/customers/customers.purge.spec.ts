import { CustomersService } from './customers.service';

describe('CustomersService.purgeNoWhatsappCustomers / onApplicationBootstrap', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: BigInt(i + 1), name: `K${i + 1}` }));
  const setup = (targets: { id: bigint; name: string }[]) => {
    const repo = {
      findNoWhatsappCustomers: jest.fn().mockResolvedValue(targets),
      purgeCustomers: jest.fn().mockImplementation((ids: bigint[]) =>
        Promise.resolve([{ count: 0 }, { count: 0 }, { count: ids.length }]),
      ),
    };
    const activity = { logActivity: jest.fn().mockResolvedValue(undefined) };
    const svc = new CustomersService(repo as never, {} as never, activity as never);
    return { svc, repo, activity };
  };

  afterEach(() => {
    delete process.env.PURGE_NO_WHATSAPP_ON_BOOT;
  });

  it('xoá theo lô 500 và ghi nhật ký', async () => {
    const t = setup(mk(1200));
    const r = await t.svc.purgeNoWhatsappCustomers();
    expect(r).toEqual({ deleted: 1200, sample: ['K1', 'K2', 'K3', 'K4', 'K5'] });
    expect(t.repo.purgeCustomers).toHaveBeenCalledTimes(3);
    expect(t.activity.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KHACH_HANG_XOA_TU_DONG', target: '1200 khách hàng' }),
    );
  });

  it('không có khách nào: không xoá, không ghi nhật ký', async () => {
    const t = setup([]);
    expect((await t.svc.purgeNoWhatsappCustomers()).deleted).toBe(0);
    expect(t.repo.purgeCustomers).not.toHaveBeenCalled();
    expect(t.activity.logActivity).not.toHaveBeenCalled();
  });

  it('khởi động: công tắc tắt (mặc định) thì KHÔNG đụng dữ liệu', () => {
    const t = setup(mk(3));
    t.svc.onApplicationBootstrap();
    expect(t.repo.findNoWhatsappCustomers).not.toHaveBeenCalled();
    process.env.PURGE_NO_WHATSAPP_ON_BOOT = 'false';
    t.svc.onApplicationBootstrap();
    expect(t.repo.findNoWhatsappCustomers).not.toHaveBeenCalled();
  });

  it('khởi động: công tắc bật thì dọn', async () => {
    process.env.PURGE_NO_WHATSAPP_ON_BOOT = 'true';
    const t = setup(mk(2));
    t.svc.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    expect(t.repo.purgeCustomers).toHaveBeenCalledTimes(1);
  });
});
