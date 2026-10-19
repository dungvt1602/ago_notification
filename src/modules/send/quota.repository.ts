/*
 * Tầng truy cập DB của hạn mức gửi (Prisma). Không chứa logic nghiệp vụ.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@core/db/prisma';

@Injectable()
export class QuotaRepository {
  // Đếm khách DUY NHẤT đã nhận tin thành công kể từ `since`. Dùng index (status, sentAt).
  countDistinctSentSince(since: Date) {
    return prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT COALESCE(customer_id::text, to_phone)) AS count
    FROM send_jobs
    WHERE status IN ('SENT','DELIVERED','READ')
      AND sent_at >= ${since}
      AND (customer_id IS NOT NULL OR (to_phone IS NOT NULL AND to_phone <> ''))
  `;
  }
}
