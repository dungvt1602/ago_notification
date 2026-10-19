# AGENTS.md — quy tắc cho AI/dev khi sửa backend này

1. **Không đổi logic nghiệp vụ.** Logic và câu truy vấn Prisma đã được port nguyên văn từ app Next (`baogia_whatapps/src/server`) vào service/repository từng module. Chỉ sửa khi có yêu cầu nghiệp vụ rõ ràng.
2. **Phân tầng**: controller (chỉ HTTP) → service (logic, parse zod, snapshot, audit) → repository (nơi DUY NHẤT gọi Prisma). Không viết nghiệp vụ trong controller, không gọi Prisma ngoài repository.
3. **Hợp đồng lỗi/phản hồi giữ nguyên** (FE phụ thuộc): lỗi luôn `{ error: string }` (+ `issues` cho zod); mutation lỗi 400, route đọc/cron/webhook lỗi 500 — truyền qua `handle(fn, status)`. Mọi `@Post` có `@HttpCode(200)`.
4. **Route tĩnh khai báo trước route `:id`** trong cùng controller.
5. **Webhook** dùng `req.rawBody` (không serialize lại body); ảnh template là body thô `image/*` (tối đa 5MB).
6. Style: prettier (`singleQuote`, `printWidth 110`), không `any`, comment tiếng Việt ngắn gọn giải thích *vì sao*.
7. Commit chỉ khi được yêu cầu. Xong việc: `npm run verify` xanh.
