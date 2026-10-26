# 06 — Hợp đồng với Frontend

FE (`baogia_whatapps`) gọi URL tương đối `/api/...` qua `getJSON/postJSON/patchJSON/sendJSON` (`src/components/common/api.ts`). Để chuyển sang BE này mà **không sửa FE**: rewrite `/api/*` → `http://<be>:4000/api/*` trong `next.config.ts` (hoặc reverse proxy cùng origin).

- Phản hồi luôn JSON (trừ ngoại lệ bên dưới). Lỗi: `{ "error": "<thông điệp>" }`; lỗi zod: `{ "error": "Dữ liệu không hợp lệ", "issues": [...] }` (400).
- id/đếm BigInt trả về dạng **chuỗi**.
- Header FE gắn: `x-actor-id` (chỉ số), `x-actor-name` (URL-encoded) — nếu gọi khác origin, đặt `CORS_ORIGINS` (đã cho phép 2 header này).
- Ngoại lệ không-JSON: `GET /api/templates/:id/image` (404 text `Chưa có ảnh`, 302 sang URL storage, hoặc bytes ảnh); `POST /api/templates/:id/image` (body thô `image/*` ≤ 5MB); `GET /api/zalo/oauth/callback` (302 về `/zalo-oa?...`); `GET /api/webhooks/whatsapp` (text challenge).
- Mã trạng thái: mutation lỗi → 400; route đọc, cron, webhook lỗi → 500; không tìm thấy (báo giá/template/lệnh gửi) → 404; đăng nhập sai → 401.

---

## Báo giá nhà cung cấp (RFQ) qua Zalo — hợp đồng API (PLAN-0001)

Quy ước chung như trên: lỗi `{ "error": string }`, id là **chuỗi**, tiền/số lượng là **chuỗi số thập phân** (Decimal), thời gian ISO-8601. Route nội bộ gắn `x-actor-id`/`x-actor-name`; route công khai KHÔNG cần.

### Nhà cung cấp
- `GET /api/suppliers?search=` → `Supplier[]`
- `POST /api/suppliers` `{name*, company?, phone?, email?, zaloUserId?, note?}` → `Supplier`
- `PATCH /api/suppliers/:id` (một phần) → `Supplier` · `DELETE /api/suppliers/:id` → `{ok:true}` (400 nếu đã có lời mời)
- `Supplier = {id, name, company, phone, email, zaloUserId, note, status:"ACTIVE", createdAt, updatedAt}`

### Yêu cầu báo giá (RFQ)
- `GET /api/supplier-rfqs?search=&status=` → `[{id, code, title, status, currency, deadline, createdAt, itemCount, invitationCount, submittedCount}]`
- `POST /api/supplier-rfqs` `{title*, note?, currency?="VND", deadline?(ISO), items:[{product*, spec?, unit?, quantity?, note?}]}` → `RfqDetail` (mã tự sinh `RFQ-YYYY-NNNN`)
- `GET /api/supplier-rfqs/:id` → `RfqDetail` · `PATCH /api/supplier-rfqs/:id` `{title?, note?, currency?, deadline?}` · `DELETE /api/supplier-rfqs/:id` (chỉ DRAFT)
- `PUT /api/supplier-rfqs/:id/items` `{items:[...]}` (chỉ DRAFT) → `RfqDetail`
- `POST /api/supplier-rfqs/:id/image` (body thô `image/*`, ≤5MB) · `DELETE .../image` · `GET .../image` (CÔNG KHAI, bytes; 404 text "Chưa có ảnh")
- `POST /api/supplier-rfqs/:id/send` `{supplierIds:[id], resend?:boolean}` → `{results:[{supplierId, supplierName, ok, status, error?, invitationId?}]}`
- `POST /api/supplier-rfqs/:id/close` → `RfqDetail`
- `GET /api/supplier-rfqs/test-recipients` → `[{userId, name, zaloUserId}]` (nhân viên đã liên kết Zalo)
- `POST /api/supplier-rfqs/:id/test-send` `{zaloUserId*}` → `{ok, mode:"list"|"text", link, error?, zalo?}` (luôn gọi Zalo thật; `zalo` = phản hồi thô của Zalo để chẩn đoán)
- `GET /api/supplier-rfqs/:id/compare` → `{rfq:{id,code,title,currency,deadline,status}, suppliers:[{invitationId, supplierId, name, status, submittedAt, version, currency, note}], rows:[{itemId, no, product, unit, quantity, prices:[{invitationId, unitPrice, moq, leadTimeDays, note}|null], bestInvitationId|null}]}`
- `RfqDetail = {id, code, title, note, currency, deadline, status:"DRAFT"|"SENT"|"CLOSED", hasImage, createdAt, items:[{id, no, product, spec, unit, quantity, note}], invitations:[{id, supplierId, supplierName, status:"PENDING"|"SENT"|"VIEWED"|"SUBMITTED"|"EXPIRED"|"FAILED", isTest, sentAt, viewedAt, submittedAt, error}]}`

### Công khai theo token (NCC mở từ Zalo)
- `GET /api/public/supplier-rfq/:token` → `{rfq:{code,title,note,currency,deadline,hasImage,imageUrl}, supplierName, isTest, expired, canSubmit, items:[{id,no,product,spec,unit,quantity,note}], quote:{version, currency, validUntil, note, items:[{rfqItemId, unitPrice, moq, leadTimeDays, note}]}|null}`
- `POST /api/public/supplier-rfq/:token/quote` `{currency?, validUntil?(YYYY-MM-DD), note?, items:[{rfqItemId*, unitPrice*, moq?, leadTimeDays?, note?}]}` → `{ok:true, version}`
- Lỗi: token sai/hết hạn → 404 `Link không hợp lệ hoặc đã hết hạn.`; quá hạn → 400 `Đã quá hạn báo giá.`; quá nhiều lần → 429 `Thao tác quá nhanh, thử lại sau.`

### Thay đổi sau review (bổ sung hợp đồng RFQ)
- `POST .../send` và `.../test-send`: link/URL ảnh chỉ theo `APP_BASE_URL`; chưa cấu hình → 400 `Chưa cấu hình APP_BASE_URL (domain FE) — không thể tạo link báo giá.`
- `send`: `results[].error` thêm: `Đang gửi cho nhà cung cấp này, vui lòng chờ.` (bấm đúp/đồng thời, ok=false), `Nhà cung cấp đã ngừng hoạt động.`, `Lỗi hệ thống khi gửi, thử lại sau.`. Gửi lại (`resend`) lỗi thì link cũ vẫn dùng được; thành công thì link cũ vô hiệu.
- `test-send`: tối đa 20 lượt/giờ/RFQ → 429 `Đã nhắn thử quá nhiều lần, thử lại sau.`
- `PATCH /api/supplier-rfqs/:id` đổi `deadline` → dời hạn link của lời mời thật = hạn mới + 30 ngày.
- Nộp giá công khai: `unitPrice` phải > 0 (bỏ trống để không báo giá mặt hàng đó); `currency` nếu gửi phải bằng tiền tệ của RFQ, sai → 400 `Tiền tệ phải là <CUR>.` (bỏ trống = tiền tệ RFQ); RFQ đã đóng → 400 `Yêu cầu báo giá đã đóng.`; body > 64kb → 413 `{error:"Dữ liệu gửi lên quá lớn."}`.
- Giới hạn tần suất công khai: 30 lượt/phút theo token+IP và 120 lượt/phút theo IP (429 `Thao tác quá nhanh, thử lại sau.`). Ảnh RFQ POST tối đa 5MB (parser nhận tới 6MB để trả đúng thông báo).
