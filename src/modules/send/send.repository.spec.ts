import { SendRepository } from './send.repository';

const tx = {
  customer: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  sendJob: { count: jest.fn(), updateMany: jest.fn() },
  inboundMessage: { count: jest.fn() },
  auditLog: { deleteMany: jest.fn() },
};

jest.mock('@core/db/prisma', () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

describe('SendRepository.deleteCustomerWithoutWhatsapp', () => {
  const repo = new SendRepository();
  beforeEach(() => {
    jest.clearAllMocks();
    tx.customer.findUnique.mockResolvedValue({ name: 'Dario', whatsappPhone: '39 123', phone: null });
    tx.sendJob.count.mockResolvedValue(0);
    tx.inboundMessage.count.mockResolvedValue(0);
  });

  it('khách chưa từng nhận/nhắn: huỷ tin chưa gửi rồi xoá khách', async () => {
    const r = await repo.deleteCustomerWithoutWhatsapp(7n);
    expect(r).toEqual({ deleted: true, name: 'Dario', phone: '39 123' });
    expect(tx.sendJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 7n, status: { in: ['QUEUED', 'HOLD'] } } }),
    );
    expect(tx.customer.delete).toHaveBeenCalledWith({ where: { id: 7n } });
  });

  it('đã từng giao/đọc thành công: không xoá, chỉ đánh dấu NO_WHATSAPP', async () => {
    tx.sendJob.count.mockResolvedValue(1);
    const r = await repo.deleteCustomerWithoutWhatsapp(7n);
    expect(r).toEqual({ deleted: false });
    expect(tx.customer.delete).not.toHaveBeenCalled();
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { waStatus: 'NO_WHATSAPP' } });
  });

  it('đã nhắn lại: không xoá', async () => {
    tx.inboundMessage.count.mockResolvedValue(2);
    expect((await repo.deleteCustomerWithoutWhatsapp(7n)).deleted).toBe(false);
    expect(tx.customer.delete).not.toHaveBeenCalled();
  });

  it('khách không còn tồn tại: không làm gì', async () => {
    tx.customer.findUnique.mockResolvedValue(null);
    expect(await repo.deleteCustomerWithoutWhatsapp(7n)).toEqual({ deleted: false });
    expect(tx.customer.delete).not.toHaveBeenCalled();
  });
});
