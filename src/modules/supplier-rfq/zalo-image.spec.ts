import sharp from 'sharp';
import { compressForZalo, ZALO_IMAGE_MAX_BYTES } from './zalo-image';

describe('compressForZalo', () => {
  it('nén ảnh PNG nhiễu lớn xuống <= giới hạn và ra JPEG', async () => {
    const w = 3000;
    const h = 2000;
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256); // nhiễu ngẫu nhiên: khó nén
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    expect(png.length).toBeGreaterThan(1_000_000);

    const out = await compressForZalo(png);
    expect(out.length).toBeLessThanOrEqual(ZALO_IMAGE_MAX_BYTES);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
  });

  it('ảnh hỏng thì ném lỗi', async () => {
    await expect(compressForZalo(Buffer.from('không phải ảnh'))).rejects.toThrow();
  });
});
