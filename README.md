# Ago Báo giá — Backend (NestJS + Express)

Backend tách ra từ các API route của app Next.js (`../baogia_whatapps/src/app/api`). **Logic nghiệp vụ giữ nguyên**: logic và từng câu truy vấn Prisma được chuyển nguyên văn từ `src/server` sang service/repository của từng module (`src/modules/*`); `src/core` giữ hàm thuần, kết nối Prisma và zod schema.

## Công nghệ
NestJS 12 (nền **Express**), TypeScript strict, Prisma 7 (adapter-pg) + PostgreSQL (Supabase), zod 4, WhatsApp Cloud API, Zalo OA, Telegram.

## Cấu trúc
```
src/
  main.ts            bootstrap: rawBody, json 50mb, raw image/*, webhook raw, helmet, CORS, prefix /api
  app.module.ts
  common/            handle() (≙ handle của Next), AllExceptionsFilter, webReq(), audit/ (AuditService, global)
  core/              db/prisma.ts, lib/ (hàm thuần: whatsapp, telegram, placeholders...), validation/ (zod schema)
  shared/            countries.ts, activityLabels.ts (dùng chung với FE)
  modules/<nhóm>/    <nhóm>.module.ts
                     <nhóm>.controller.ts   HTTP mỏng: decorator, @Req/@Body, handle(() => service..., status)
                     <nhóm>.service.ts      logic + điều phối (parse zod, snapshot, audit)
                     <nhóm>.repository.ts   NƠI DUY NHẤT gọi Prisma
  modules/worker/    worker gửi nền (≙ src/instrumentation.ts)
prisma/              schema.prisma, schema.sql, seed.ts
docs/                tài liệu (xem docs/01, docs/06)
```
Module: activity, auth, channels, cron, customers, dashboard, health, inbound (+auto-reply), notification, quotations, receive-channels, send (+quota, send-job), supplier-rfq (báo giá NCC qua Zalo, + route công khai theo token), suppliers, templates (+meta-sync), users, webhooks, worker, zalo (+token, link, sender, client). Test tích hợp RFQ: `npm run test:rfq` (Docker).

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
