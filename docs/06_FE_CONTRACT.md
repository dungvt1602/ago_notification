# 06 — Hợp đồng với Frontend

FE (`baogia_whatapps`) gọi URL tương đối `/api/...` qua `getJSON/postJSON/patchJSON/sendJSON` (`src/components/common/api.ts`). Để chuyển sang BE này mà **không sửa FE**: rewrite `/api/*` → `http://<be>:4000/api/*` trong `next.config.ts` (hoặc reverse proxy cùng origin).

- Phản hồi luôn JSON (trừ ngoại lệ bên dưới). Lỗi: `{ "error": "<thông điệp>" }`; lỗi zod: `{ "error": "Dữ liệu không hợp lệ", "issues": [...] }` (400).
- id/đếm BigInt trả về dạng **chuỗi**.
- Header FE gắn: `x-actor-id` (chỉ số), `x-actor-name` (URL-encoded) — nếu gọi khác origin, đặt `CORS_ORIGINS` (đã cho phép 2 header này).
- Ngoại lệ không-JSON: `GET /api/templates/:id/image` (404 text `Chưa có ảnh`, 302 sang URL storage, hoặc bytes ảnh); `POST /api/templates/:id/image` (body thô `image/*` ≤ 5MB); `GET /api/zalo/oauth/callback` (302 về `/zalo-oa?...`); `GET /api/webhooks/whatsapp` (text challenge).
- Mã trạng thái: mutation lỗi → 400; route đọc, cron, webhook lỗi → 500; không tìm thấy (báo giá/template/lệnh gửi) → 404; đăng nhập sai → 401.
