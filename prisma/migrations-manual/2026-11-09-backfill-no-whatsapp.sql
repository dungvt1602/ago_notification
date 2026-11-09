-- Đánh dấu lại khách có số KHÔNG có WhatsApp từ các lần gửi đã fail trước đó (131026 = Message undeliverable).
-- Chỉ ĐÁNH DẤU (wa_status = 'NO_WHATSAPP'), KHÔNG xoá. Sau đó vào màn Khách hàng, lọc "Không có WhatsApp",
-- xem danh sách rồi mới xoá hàng loạt.
-- Bỏ qua khách đã từng được giao/đọc thành công trên WhatsApp (131026 là tín hiệu yếu).
-- An toàn chạy lại nhiều lần (idempotent).

-- 1) Xem trước: bao nhiêu khách sẽ được đánh dấu
SELECT count(DISTINCT j.customer_id) AS se_danh_dau
FROM send_jobs j
JOIN customers c ON c.id = j.customer_id
WHERE j.channel = 'WHATSAPP'
  AND j.error LIKE '%131026%'
  AND (c.wa_status IS NULL OR c.wa_status <> 'NO_WHATSAPP')
  AND NOT EXISTS (
    SELECT 1 FROM send_jobs ok
    WHERE ok.customer_id = j.customer_id AND ok.channel = 'WHATSAPP' AND ok.status IN ('DELIVERED', 'READ')
  );

-- 2) Đánh dấu
UPDATE customers c
SET wa_status = 'NO_WHATSAPP'
WHERE (c.wa_status IS NULL OR c.wa_status <> 'NO_WHATSAPP')
  AND EXISTS (
    SELECT 1 FROM send_jobs j
    WHERE j.customer_id = c.id AND j.channel = 'WHATSAPP' AND j.error LIKE '%131026%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM send_jobs ok
    WHERE ok.customer_id = c.id AND ok.channel = 'WHATSAPP' AND ok.status IN ('DELIVERED', 'READ')
  );
