# Ago Báo giá — Backend (NestJS + Express)

Backend tách ra từ các API route của app Next.js (`../baogia_whatapps/src/app/api`). **Logic nghiệp vụ giữ nguyên**: thư mục `src/core` là bản copy nguyên văn của `src/server` (service, lib, validation, Prisma); `src/modules/*` chỉ là lớp HTTP mỏng port 1:1 từng route.

## Công nghệ
NestJS 12 (nền **Express**), TypeScript strict, Prisma 7 (adapter-pg) + PostgreSQL (Supabase), zod 4, WhatsApp Cloud API, Zalo OA, Telegram.

## Cấu trúc
```
src/
  main.ts            bootstrap: rawBody, json 50mb, raw image/*, helmet, CORS, prefix /api
  app.module.ts
  common/            handle() (≙ handle của Next), AllExceptionsFilter, webReq() (Express -> shape cũ)
  core/              LOGIC GỐC (không sửa khi port): services/ lib/ validation/ db/ http/
  shared/            countries.ts, activityLabels.ts (dùng chung với FE)
  modules/<nhóm>/    <nhóm>.controller.ts + <nhóm>.module.ts  (1 nhóm = 1 thư mục route của Next)
  modules/worker/    worker gửi nền (≙ src/instrumentation.ts)
prisma/              schema.prisma, schema.sql, seed.ts
docs/                tài liệu (xem docs/00..06)
```

## Chạy
```bash
cp .env.example .env        # điền DATABASE_URL, DIRECT_URL, khóa WhatsApp/Zalo...
npm install                 # postinstall = prisma generate
npm run start:dev           # http://localhost:4000/api/health
npm run verify              # lint + build + test
```
Mặc định `SEND_DRY_RUN=true` (gửi giả). **Đặt `false` mới gửi thật tới khách.**

## Khác biệt có chủ đích so với bản Next
Chỉ phần hạ tầng: Express thay `NextResponse`, worker chạy trong `OnApplicationBootstrap` thay `instrumentation.ts`, bỏ route demo `/api/hello`. Chi tiết: `docs/01_ARCHITECTURE.md`.
