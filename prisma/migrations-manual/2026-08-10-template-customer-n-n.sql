-- ============================================================
-- Di trú 1-N  ->  N-N   (template  <->  customer)
-- ------------------------------------------------------------
-- AN TOÀN DỮ LIỆU: tạo bảng nối + COPY link cũ TRƯỚC,
-- rồi mới DROP cột customers.template_id. Tất cả trong 1 transaction:
-- nếu có lỗi giữa chừng sẽ rollback, không mất mát.
--
-- Tên bảng/khoá/khối index đặt trùng convention Prisma để sau khi
-- chạy xong `prisma db push` báo "in sync" (không sinh diff).
-- ============================================================

BEGIN;

-- 1) Bảng nối N-N
CREATE TABLE IF NOT EXISTS template_customers (
  template_id bigint       NOT NULL,
  customer_id bigint       NOT NULL,
  created_at  timestamp(6) NOT NULL DEFAULT now(),
  CONSTRAINT template_customers_pkey PRIMARY KEY (template_id, customer_id),
  CONSTRAINT template_customers_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT template_customers_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS template_customers_customer_id_idx
  ON template_customers(customer_id);

-- 2) Copy toàn bộ liên kết cũ (customers.template_id) sang bảng nối
INSERT INTO template_customers (template_id, customer_id)
SELECT template_id, id
FROM customers
WHERE template_id IS NOT NULL
ON CONFLICT (template_id, customer_id) DO NOTHING;

-- 3) Bỏ cột cũ (dữ liệu đã copy an toàn ở bước 2; FK cũ tự bị drop theo cột)
ALTER TABLE customers DROP COLUMN IF EXISTS template_id;

COMMIT;

-- ---- Kiểm tra sau khi chạy (tuỳ chọn) ----
-- SELECT count(*) AS so_link FROM template_customers;
-- SELECT * FROM template_customers ORDER BY template_id, customer_id;
