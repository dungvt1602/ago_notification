# 01 — Kiến trúc

## Nguyên tắc port
- **Giữ nguyên logic và câu truy vấn**: hàm trong `src/server/services` (Next) được chuyển thành method của service + repository trong từng module; mỗi lời gọi Prisma giữ NGUYÊN (model, where, orderBy, select/include, take/skip, data, thứ tự, ranh giới transaction).
- **Phân tầng** (theo eco_backend): `controller` (HTTP) → `service` (logic, điều phối, audit) → `repository` (chỉ nơi này gọi Prisma, import singleton `@core/db/prisma`). Method giữ tên hàm gốc để các module gọi nhau qua DI.
- `ActivityService`/`AuditService` là module **global** (nhật ký thao tác dùng ở mọi nơi). `quotations` ↔ `templates` gọi lẫn nhau nên dùng `forwardRef`.
- Trạng thái cấp module của bản Next (cache hạn mức 30s, cờ `oaIdCaptured`, khóa refresh token đang chạy, cache uid Zalo...) chuyển thành field private của service singleton — mỗi service chỉ được khai báo ở MỘT module (đừng provide lại).
- Hàm thuần không chạm DB (`whatsapp`, `telegram`, `placeholders`...) vẫn ở `src/core/lib`.

## Phần hạ tầng thay thế (duy nhất khác bản Next)
| Next | Nest |
|---|---|
| `handle()` + `json()` (`NextResponse`) | `common/http/handle.ts` ném `HttpException`; `AllExceptionsFilter` in `{error}`; BigInt→string qua `app.set('json replacer')` |
| `req.headers.get`, `nextUrl` | `webReq(req)` bọc request Express thành `{headers.get, protocol, host}` (`ReqLike`) |
| `await req.text()` (webhook) | `NestFactory.create(..., { rawBody: true })` → `req.rawBody` |
| ảnh template `req.arrayBuffer()` | `app.useBodyParser('raw', { type: 'image/*', limit: '50mb' })` |
| `src/instrumentation.ts` | `modules/worker/send-worker.service.ts` (`OnApplicationBootstrap`, timer dọn ở `OnModuleDestroy`) |
| POST mặc định 200 | Nest mặc định 201 → mọi `@Post` có `@HttpCode(200)` |
| `/api/hello` (demo) | bỏ |

## Chạy nền
Worker cùng tiến trình API: poll `processNextBatch` (mặc định 8s), dọn log 10 phút/lần, làm mới token Zalo 5 phút/lần. Tắt bằng `SEND_WORKER_DISABLED=true`. Endpoint kéo `/api/cron/*` vẫn giữ (cron-job.org khi host ngủ).

## Chưa có (giữ như bản gốc)
Không xác thực phía server — danh tính chỉ là header `x-actor-id`/`x-actor-name` do FE gắn (dùng cho nhật ký). Nên đặt BE sau proxy cùng origin hoặc thêm auth ở bước sau.

## Báo giá nhà cung cấp (RFQ) qua Zalo — PLAN-0001
Hai module mới, KHÔNG thuộc phần port từ Next (tính năng gốc của BE):
- `suppliers` — CRUD nhà cung cấp (`/api/suppliers`).
- `supplier-rfq` — RFQ + mặt hàng + ảnh + gửi/đóng/so sánh/nhắn thử (`/api/supplier-rfqs`) và route CÔNG KHAI theo token (`/api/public/supplier-rfq/:token`, giới hạn tần suất trong bộ nhớ, `rate-limiter.ts`). Tách: `supplier-rfq.service` (CRUD/ảnh/so sánh), `supplier-rfq-send.service` (gửi + nhắn thử, lùi list→text), `supplier-rfq-public.service` (xem/nộp giá), file thuần `rfq-token.ts`, `rfq-compare.ts`, `zalo-rfq-message.ts` (builder payload Zalo — MỘT chỗ duy nhất).
- Gọi Zalo qua `ZaloClient.sendRfqMessage` (dùng chung token/-216 retry); gốc API đọc từ `ZALO_API_BASE` (mặc định `https://openapi.zalo.me`) để test dùng Zalo giả.
- Nộp giá ghi `quotes` + `outbox_events` (`supplier_quote.submitted`) CÙNG transaction. Cần chạy `prisma/migrations-manual/2026-10-19-outbox-events.sql` và `2026-10-27-supplier-rfq.sql` trước khi bật.
- Test tích hợp: `npm run test:rfq` (Postgres Docker tạm 127.0.0.1:55434 + Zalo giả :55435, không chạm dịch vụ thật).
