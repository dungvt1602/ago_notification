import type { Request } from 'express';
import type { AuditService } from '@common/audit/audit.service';
import { SuppliersService } from './suppliers.service';
import type { SuppliersRepository } from './suppliers.repository';

describe('SuppliersService', () => {
  const req = { headers: {}, protocol: 'http', get: () => 'x' } as unknown as Request;
  const audit = { audit: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const make = (found: object | null, invitations = 0) => {
    const repo = {
      findById: jest.fn().mockResolvedValue(found),
      countInvitations: jest.fn().mockResolvedValue(invitations),
      create: jest.fn((d: { name: string }) => Promise.resolve({ id: 1n, ...d })),
      update: jest.fn((_id: bigint, d: { name?: string }) => Promise.resolve({ id: 1n, name: 'N', ...d })),
      remove: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    };
    return { repo, svc: new SuppliersService(repo as unknown as SuppliersRepository, audit) };
  };

  it('tạo: tên bắt buộc, ô rỗng thành null, zaloUserId chỉ gồm số', async () => {
    const t = make(null);
    await expect(t.svc.create(req, { name: ' ' })).rejects.toThrow();
    await expect(t.svc.create(req, { name: 'A', zaloUserId: 'abc' })).rejects.toThrow();
    await t.svc.create(req, {
      name: ' A ',
      company: '',
      phone: null,
      email: '',
      zaloUserId: '123',
      note: ' ',
    });
    expect(t.repo.create).toHaveBeenCalledWith({
      name: 'A',
      company: null,
      phone: null,
      email: null,
      zaloUserId: '123',
      note: null,
    });
  });

  it('PATCH chỉ đổi trường có mặt; "" xoá giá trị', async () => {
    const t = make({ id: 1n, name: 'A' });
    await t.svc.update(req, '1', { zaloUserId: '' });
    expect(t.repo.update).toHaveBeenCalledWith(1n, { zaloUserId: null });
  });

  it('xoá: có lời mời -> lỗi; không có -> ok; không tồn tại -> 404', async () => {
    await expect(make({ id: 1n, name: 'A' }, 2).svc.remove(req, '1')).rejects.toThrow('không thể xoá');
    const t = make({ id: 1n, name: 'A' }, 0);
    await expect(t.svc.remove(req, '1')).resolves.toEqual({ ok: true });
    await expect(make(null).svc.remove(req, '1')).rejects.toMatchObject({ status: 404 });
  });
});
