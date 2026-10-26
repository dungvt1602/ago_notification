import type { Request } from 'express';
import type { AuditService } from '@common/audit/audit.service';
import { detectImageMime, SupplierRfqService } from './supplier-rfq.service';
import type { SupplierRfqRepository } from './supplier-rfq.repository';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

describe('detectImageMime', () => {
  it('nhận PNG/JPEG/GIF/WebP theo byte đầu, từ chối SVG và rác', () => {
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(detectImageMime(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(detectImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('SupplierRfqService', () => {
  const req = { headers: {}, protocol: 'http', get: () => 'x' } as unknown as Request;
  const audit = { audit: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const make = (rfq: object | null) => {
    const repo = {
      findById: jest.fn().mockResolvedValue(rfq),
      upsertImage: jest.fn(),
      remove: jest.fn(),
      replaceItems: jest.fn(),
      update: jest.fn(),
    };
    return { repo, svc: new SupplierRfqService(repo as unknown as SupplierRfqRepository, audit) };
  };
  const draft = { id: 1n, code: 'RFQ-2026-0001', title: 'T', status: 'DRAFT' };

  it('chỉ xoá / sửa mặt hàng khi DRAFT', async () => {
    const t = make({ ...draft, status: 'SENT' });
    await expect(t.svc.remove(req, '1')).rejects.toThrow('Nháp');
    await expect(t.svc.replaceItems(req, '1', { items: [] })).rejects.toThrow('Nháp');
    expect(t.repo.remove).not.toHaveBeenCalled();
    expect(t.repo.replaceItems).not.toHaveBeenCalled();
  });

  it('PATCH bị chặn khi CLOSED', async () => {
    const t = make({ ...draft, status: 'CLOSED' });
    await expect(t.svc.update(req, '1', { title: 'x' })).rejects.toThrow('đã đóng');
  });

  it('không tồn tại -> 404; id không phải số -> 400', async () => {
    await expect(make(null).svc.remove(req, '1')).rejects.toMatchObject({ status: 404 });
    await expect(make(null).svc.remove(req, 'abc')).rejects.toMatchObject({ status: 400 });
  });

  it('ảnh: rỗng / quá 5MB / không phải ảnh bị từ chối, PNG hợp lệ được lưu với mime nhận diện', async () => {
    const t = make(draft);
    await expect(t.svc.setImage(req, '1', Buffer.alloc(0))).rejects.toThrow('Ảnh rỗng.');
    await expect(t.svc.setImage(req, '1', Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow('quá lớn');
    await expect(t.svc.setImage(req, '1', Buffer.from('<svg/>'))).rejects.toThrow('không phải ảnh');
    expect(t.repo.upsertImage).not.toHaveBeenCalled();
    jest
      .spyOn(t.svc, 'detail')
      .mockResolvedValue({ id: '1' } as unknown as Awaited<ReturnType<typeof t.svc.detail>>);
    await t.svc.setImage(req, '1', png);
    expect(t.repo.upsertImage).toHaveBeenCalledWith(1n, 'image/png', png);
  });
});
