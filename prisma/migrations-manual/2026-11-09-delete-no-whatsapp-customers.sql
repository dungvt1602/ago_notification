-- XOÁ khách hàng có số KHÔNG có WhatsApp (Meta 131026 trong log gửi, hoặc đã bị đánh dấu NO_WHATSAPP).
-- KHÔNG HOÀN TÁC. Làm theo thứ tự:
--   (A) Chạy MỘT MÌNH khối "A. XEM TRƯỚC" -> xem số lượng + danh sách, đồng ý rồi mới sang (B).
--   (B) Chạy nguyên khối "B. XOÁ" (đã bọc BEGIN/COMMIT). Nếu thấy số lượng lạ, thay COMMIT bằng ROLLBACK.
-- Chốt chặn: KHÔNG xoá khách đã từng được giao/đọc tin WhatsApp thành công (số đó dùng được) hoặc đã nhắn lại.
-- Dòng Log gửi giữ nguyên (đã lưu sẵn tên + SĐT); chỉ liên kết sang khách bị gỡ (customer_id -> NULL).
-- Khách bị xoá cũng bị gỡ khỏi các template (cascade). Tin QUEUED/HOLD của họ bị huỷ để worker không gửi nữa.

-- =========================== A. XEM TRƯỚC ===========================
WITH target AS (
  SELECT c.id, c.name, c.whatsapp_phone, c.phone, c.market
  FROM customers c
  WHERE (
      c.wa_status = 'NO_WHATSAPP'
      OR EXISTS (
        SELECT 1 FROM send_jobs j
        WHERE j.customer_id = c.id AND j.channel = 'WHATSAPP' AND j.error LIKE '%131026%'
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM send_jobs ok
      WHERE ok.customer_id = c.id AND ok.channel = 'WHATSAPP' AND ok.status IN ('DELIVERED', 'READ')
    )
    AND NOT EXISTS (SELECT 1 FROM inbound_messages m WHERE m.customer_id = c.id)
)
SELECT (SELECT count(*) FROM target) AS se_xoa, t.*
FROM target t
ORDER BY t.market, t.name
LIMIT 50;

-- =========================== B. XOÁ ===========================
BEGIN;

CREATE TEMP TABLE _to_delete ON COMMIT DROP AS
SELECT c.id
FROM customers c
WHERE (
    c.wa_status = 'NO_WHATSAPP'
    OR EXISTS (
      SELECT 1 FROM send_jobs j
      WHERE j.customer_id = c.id AND j.channel = 'WHATSAPP' AND j.error LIKE '%131026%'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM send_jobs ok
    WHERE ok.customer_id = c.id AND ok.channel = 'WHATSAPP' AND ok.status IN ('DELIVERED', 'READ')
  )
  AND NOT EXISTS (SELECT 1 FROM inbound_messages m WHERE m.customer_id = c.id);

SELECT count(*) AS se_xoa FROM _to_delete;

-- Huỷ tin chưa gửi (job vẫn còn nếu không huỷ vì customer_id chỉ bị SET NULL).
UPDATE send_jobs
SET status = 'FAILED', retry_count = 99,
    error = 'Số không có WhatsApp — khách đã bị xoá, tin chưa gửi đã bị huỷ.'
WHERE customer_id IN (SELECT id FROM _to_delete) AND status IN ('QUEUED', 'HOLD');

-- audit_logs.customer_id là ON DELETE RESTRICT -> phải xoá dòng audit của các khách này trước.
DELETE FROM audit_logs WHERE customer_id IN (SELECT id FROM _to_delete);

DELETE FROM customers WHERE id IN (SELECT id FROM _to_delete);

COMMIT;
