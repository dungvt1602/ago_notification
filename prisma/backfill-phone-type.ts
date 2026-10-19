// Backfill nhãn loại số cho toàn bộ khách hàng hiện có (Việc 4). Chạy MỘT LẦN:
//
//   npx tsx prisma/backfill-phone-type.ts            # dry-run: chỉ đếm, KHÔNG ghi
//   npx tsx prisma/backfill-phone-type.ts --apply    # ghi nhãn vào cột customers.phone_type
//
// Chỉ đụng cột phone_type (suy từ dãy số + quốc gia). KHÔNG đụng wa_status — cột đó chỉ
// được suy từ kết quả gửi thật (lỗi 131026 lặp lại), không có dữ liệu nào để backfill.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { detectPhoneType } from "../src/core/lib/phoneType";

const APPLY = process.argv.includes("--apply");
const BATCH = 1000;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.customer.count();
  const counts: Record<string, number> = { MOBILE: 0, FIXED_LINE: 0, AMBIGUOUS: 0, UNKNOWN: 0 };
  let processed = 0;
  let updated = 0;

  // Phân trang theo id (khoá tăng dần, ổn định) — tránh nạp cả 8k dòng một lần.
  let cursor = BigInt(0);
  while (true) {
    const rows = await prisma.customer.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, whatsappPhone: true, phone: true, market: true, phoneType: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const c of rows) {
      const t = detectPhoneType(c.whatsappPhone || c.phone || "", c.market);
      counts[t]++;
      processed++;
      if (APPLY && c.phoneType !== t) {
        await prisma.customer.update({ where: { id: c.id }, data: { phoneType: t } });
        updated++;
      }
    }
    if (!APPLY) console.log(`[dry-run] đã quét ${processed}/${total} khách...`);
  }

  console.log("\n=== Kết quả phân loại số ===");
  console.log(`Tổng khách: ${total} | đã quét: ${processed}`);
  console.log(`MOBILE (Di động):      ${counts.MOBILE}`);
  console.log(`FIXED_LINE (Máy bàn):  ${counts.FIXED_LINE}`);
  console.log(`AMBIGUOUS (Không rõ):  ${counts.AMBIGUOUS}`);
  console.log(`UNKNOWN (Không xác định): ${counts.UNKNOWN}`);
  if (APPLY) console.log(`\nĐã cập nhật ${updated} khách.`);
  else console.log(`\n(dry-run — chưa ghi gì. Thêm --apply để ghi thật.)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
