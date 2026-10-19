-- ============================================================
-- Việc 4 (gắn nhãn loại số) + Việc 3 (hạn mức 24h) — cột + index mới
-- ------------------------------------------------------------
-- AN TOÀN: CHỈ THÊM cột + index, không xoá/sửa dữ liệu nào.
-- Chạy trên Supabase SQL Editor (hoặc `prisma db push` sau khi sửa schema.prisma).
-- ============================================================

-- 1) customers: cột loại số + trạng thái WhatsApp
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_type varchar(20),
  ADD COLUMN IF NOT EXISTS wa_status varchar(20);

CREATE INDEX IF NOT EXISTS customers_phone_type_idx ON customers(phone_type);

-- 2) send_jobs: index cho webhook cập nhật trạng thái giao (theo message_id) + đếm hạn mức 24h
CREATE INDEX IF NOT EXISTS send_jobs_message_id_idx ON send_jobs(message_id);
CREATE INDEX IF NOT EXISTS send_jobs_status_sent_at_idx ON send_jobs(status, sent_at);

-- ---- Kiểm tra sau khi chạy (tuỳ chọn) ----
-- SELECT count(*) FILTER (WHERE phone_type = 'MOBILE') AS mobile,
--        count(*) FILTER (WHERE phone_type = 'FIXED_LINE') AS fixed_line,
--        count(*) FILTER (WHERE phone_type = 'AMBIGUOUS') AS ambiguous,
--        count(*) FILTER (WHERE phone_type IS NULL) AS chua_gan
-- FROM customers;
