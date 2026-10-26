# PLAN-0001 — Báo giá nhà cung cấp (RFQ) gửi qua Zalo

> Status: Draft → In progress
> Owner: Ago Group
> Liên quan: FE `baogia_whatapps` PLAN-0002 (cùng tên), `docs/06_FE_CONTRACT.md`

## 1. Mục tiêu
Gửi **yêu cầu báo giá (RFQ)** cho nhà cung cấp (NCC) qua **Zalo OA** kèm hình ảnh; NCC bấm nút trong tin để mở **form web** (trong trình duyệt của Zalo) nhập giá từng mặt hàng; dữ liệu lưu có cấu trúc và hiển thị/so sánh trên hệ thống. Có nút **"Nhắn thử"** để gửi đúng tin đó tới Zalo của người dùng nội bộ trước khi gửi NCC thật. Sau này ERP đọc dữ liệu qua API/outbox.

## 2. Quyết định thiết kế
- Zalo không có form nhập ngay trong chat (khác WhatsApp Flow) → tin có ảnh + tiêu đề + tóm tắt + **nút mở link** `APP_BASE_URL/ncc/<token>`; form web đóng vai "Flow".
- Mỗi NCC một **token ngẫu nhiên** (32 byte, chỉ lưu SHA-256), có hạn, không cần đăng nhập.
- Tin Zalo = **tin tư vấn** `POST /v3.0/oa/message/cs` (khách phải đã tương tác OA trong ~48h). Dựng payload ở MỘT chỗ (`zalo-rfq-message.ts`) với 2 chế độ: `list` (ảnh + tiêu đề + mô tả + mở link) và `text` (văn bản + link, dự phòng). Nếu `list` bị Zalo từ chối vì định dạng, tự lùi về `text`. Định dạng chưa đối chiếu được tài liệu chính thức → nút Nhắn thử hiển thị nguyên phản hồi Zalo để chỉnh.
- Chưa làm: tin truyền thông/ZNS, theo dõi hạn mức Zalo (ghi vào Rủi ro).
- Gửi cho NCC thật tôn trọng `SEND_DRY_RUN` (không gọi Zalo, đánh dấu DRYRUN). **Nhắn thử luôn gọi Zalo thật** vì là thao tác chủ động, chỉ tới `user_id` được chỉ định.
- Ảnh RFQ lưu trong DB (bảng riêng), phục vụ công khai ở `GET /api/supplier-rfqs/:id/image` để Zalo tải được.
- Nộp giá ghi **phiên bản** (version); so sánh lấy phiên bản mới nhất; lời mời thử (`is_test`) không vào so sánh.
- Khi NCC nộp giá: ghi `outbox_events` (`supplier_quote.submitted`) CÙNG transaction để ERP lấy sau. API đọc cho ERP (API key) để pha sau.

## 3. Phạm vi
- Trong: bảng + SQL, module `supplier-rfq` (controller/service/repository), module `suppliers`, builder tin Zalo + `ZaloClient.sendRfqMessage`, API công khai theo token, nút Nhắn thử, so sánh giá, test, docs.
- Ngoài: tin truyền thông/ZNS, hạn mức Zalo, API key cho ERP, nhắc hạn tự động, đa tiền tệ trong một báo giá.

## 4. Dữ liệu (Prisma + SQL idempotent `prisma/migrations-manual/2026-10-27-supplier-rfq.sql`)
`suppliers`, `supplier_rfqs`, `supplier_rfq_items`, `supplier_rfq_images`, `supplier_rfq_invitations` (unique `(rfq_id, supplier_id)`, `token_hash` unique, `is_test`), `supplier_quotes` (unique `(invitation_id, version)`), `supplier_quote_items` (unique `(quote_id, rfq_item_id)`). Id BigInt; tiền Decimal(18,4); thời gian timestamptz(6).
Trạng thái RFQ: `DRAFT | SENT | CLOSED`. Lời mời: `PENDING | SENT | VIEWED | SUBMITTED | EXPIRED | FAILED`.

## 5. API (xem hợp đồng chi tiết ở `docs/06_FE_CONTRACT.md` mục RFQ)
Nội bộ (header `x-actor-*` như các route khác): `/api/suppliers`, `/api/supplier-rfqs` (CRUD, items, image, send, close, test-send, test-recipients, compare).
Công khai theo token: `GET /api/public/supplier-rfq/:token`, `POST /api/public/supplier-rfq/:token/quote` (giới hạn tần suất theo token+IP).

## 6. Các bước (checklist)
- [x] Schema Prisma + SQL idempotent, kiểm bằng `db push` + chạy SQL trên Postgres tạm
- [x] `suppliers`: controller/service/repository + test
- [x] `supplier-rfq`: tạo/sửa/xoá, items, ảnh, đóng, so sánh + test
- [x] Token + lời mời + gửi (tôn trọng dry-run) + nút Nhắn thử + `ZaloClient.sendRfqMessage` (+ `ZALO_API_BASE` để test với Zalo giả) + test
- [x] API công khai + nộp giá + outbox + rate limit + test
- [x] Test tích hợp trên Postgres tạm với Zalo giả
- [x] Review độc lập (bảo mật, đúng plan) → sửa
- [x] Cập nhật docs; chạy SQL trên DB thật là bước thủ công của chủ hệ thống

## 7. Test
Unit: tạo/băm token, builder payload, validate nộp giá (số âm, thiếu mặt hàng, quá hạn), ma trận so sánh, rate limit. Tích hợp: Postgres tạm + Zalo giả (`ZALO_API_BASE`): gửi, nhắn thử, mở link, nộp giá 2 lần (version), so sánh, outbox. Tuyệt đối KHÔNG gọi Zalo thật trong test tự động.

## 8. Rủi ro
- Định dạng tin `list` và điều kiện 48h của Zalo chưa xác minh với tài liệu chính thức; NCC chưa tương tác OA sẽ bị Zalo từ chối → lỗi hiển thị trong kết quả gửi.
- NCC chỉ cần SĐT hoặc `zalo_user_id`: SĐT được tra ra user_id qua `ZaloClient.resolveZaloUserId` (và lưu lại); NCC phải đã Quan tâm OA, nếu chưa Zalo từ chối (-232/-201) và lỗi hiển thị trong kết quả gửi.
- Trang công khai không đăng nhập: bảo vệ bằng token dài + hạn + giới hạn tần suất; không lộ dữ liệu NCC khác.
- Production phải chạy 2 file SQL (outbox + supplier-rfq) trước khi bật.
- Chưa có hạn mức Zalo: gửi hàng loạt có thể vượt gói OA.
- HOÃN (chấp nhận, ghi nhận sau review): ảnh RFQ công khai đoán được theo id tuần tự (hệ thống chưa có xác thực server cho route nội bộ nên không che được); race đóng RFQ/nộp giá sát hạn chót (có thể nhận 1 bản nộp ngay sau khi đóng).
- Đã xử lý sau review: link chỉ theo `APP_BASE_URL`; body công khai ≤64kb; limiter 2 nấc + trần bộ nhớ; nhắn thử ≤20/giờ/RFQ; chặn gửi đồng thời cùng NCC, hash mới lưu trước khi gửi; giá > 0, tiền tệ theo RFQ; dời hạn link khi đổi deadline.


## 9. Files changed / DoD
Mới: `prisma/migrations-manual/2026-10-27-supplier-rfq.sql` (+ nối vào `prisma/schema.sql`); 7 model trong `prisma/schema.prisma`; `src/modules/suppliers/*`; `src/modules/supplier-rfq/*` (controller nội bộ + công khai, 3 service, repository, `rfq-token.ts`, `rfq-compare.ts`, `rate-limiter.ts`, `zalo-rfq-message.ts`, `rfq-errors.ts` + spec); `src/core/validation/supplier.schema.ts`, `supplierRfq.schema.ts` (+ spec); `src/common/http/parse-id.ts`; `test/supplier-rfq/run.ts` (script `npm run test:rfq`).
Sửa: `src/app.module.ts` (đăng ký 2 module), `src/main.ts` (body thô cho ảnh RFQ), `src/modules/zalo/zalo.client.ts` (`ZALO_API_BASE`, `sendRfqMessage`), `src/shared/activityLabels.ts` (nhóm + nhãn NCC_*/RFQ_*), `.env.example`, `package.json`, README, `docs/01_ARCHITECTURE.md`.
Hành vi cần biết: gửi lại (`resend`) SINH TOKEN MỚI (chỉ lưu hash nên không dựng lại link cũ; link cũ vô hiệu khi gửi lại thành công); lời mời thử không phát outbox; ảnh chỉ nhận PNG/JPEG/GIF/WebP (nhận diện theo byte, không SVG).
DoD: `npm run lint`, `npm run build`, `npm test`, `npm run test:rfq` xanh; review không còn lỗi mức cao (bước review độc lập còn mở).
