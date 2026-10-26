import sharp from 'sharp';

/*
 * Nén ảnh RFQ trước khi Zalo tải về: tin ảnh của Zalo OA giới hạn dung lượng (~1MB), ảnh gốc của người dùng
 * (tối đa 5MB) thường vượt. Luôn ra JPEG nền trắng, giảm dần cạnh dài + chất lượng tới khi <= MAX_BYTES.
 * Chỉ dùng cho bản phát cho Zalo; ảnh gốc (trang NCC) giữ nguyên.
 */
export const ZALO_IMAGE_MAX_BYTES = 900_000;
const SIZES = [1600, 1280, 1024, 800, 640];
const QUALITIES = [85, 75, 65, 55];

export async function compressForZalo(input: Uint8Array): Promise<Buffer> {
  let last: Buffer = Buffer.alloc(0);
  for (const size of SIZES) {
    for (const quality of QUALITIES) {
      last = await sharp(input)
        .rotate() // theo EXIF để ảnh ảnh chụp điện thoại không bị xoay
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (last.length <= ZALO_IMAGE_MAX_BYTES) return last;
    }
  }
  return last;
}
