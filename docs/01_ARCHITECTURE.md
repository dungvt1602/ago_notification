# 01 — Kiến trúc

## Nguyên tắc port
- **Giữ nguyên logic**: `src/server/{services,lib,validation,db}` (Next) → `src/core/*` (Nest), chỉ đổi alias import (`@/server/*` → `@core/*`, `@/components/common/*` → `@shared/*`) và bỏ `import "server-only"`.
- Service là hàm thuần dùng Prisma singleton (`src/core/db/prisma.ts`), **không qua DI** — đúng như bản gốc, tránh đổi hành vi/vòng phụ thuộc (`zalo.ts` ↔ `zaloTokenService`).
- Controller port 1:1 từng `route.ts`: cùng schema zod, cùng `audit()`, cùng mã trạng thái + thông điệp lỗi.

## Phần hạ tầng thay thế (duy nhất khác bản Next)
| Next | Nest |
|---|---|
| `handle()` + `json()` (`NextResponse`) | `common/http/handle.ts` ném `HttpException`; `AllExceptionsFilter` in `{error}`; BigInt→string qua `app.set('json replacer')` |
| `req.headers.get`, `nextUrl` | `webReq(req)` bọc request Express thành `{headers.get, protocol, host}` (`ReqLike`) |
| `await req.text()` (webhook) | `NestFactory.create(..., { rawBody: true })` → `req.rawBody` |
| ảnh template `req.arrayBuffer()` | `app.useBodyParser('raw', { type: 'image/*', limit: '6mb' })` |
| `src/instrumentation.ts` | `modules/worker/send-worker.service.ts` (`OnApplicationBootstrap`, timer dọn ở `OnModuleDestroy`) |
| POST mặc định 200 | Nest mặc định 201 → mọi `@Post` có `@HttpCode(200)` |
| `/api/hello` (demo) | bỏ |

## Chạy nền
Worker cùng tiến trình API: poll `processNextBatch` (mặc định 8s), dọn log 10 phút/lần, làm mới token Zalo 5 phút/lần. Tắt bằng `SEND_WORKER_DISABLED=true`. Endpoint kéo `/api/cron/*` vẫn giữ (cron-job.org khi host ngủ).

## Chưa có (giữ như bản gốc)
Không xác thực phía server — danh tính chỉ là header `x-actor-id`/`x-actor-name` do FE gắn (dùng cho nhật ký). Nên đặt BE sau proxy cùng origin hoặc thêm auth ở bước sau.
