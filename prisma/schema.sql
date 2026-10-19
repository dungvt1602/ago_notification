-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "channels" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "api_key_env" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "unit" VARCHAR(50),
    "packing" VARCHAR(150),
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
    "market" VARCHAR(50),
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "assigned_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255),
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "market" VARCHAR(50),
    "issued_date" DATE,
    "valid_until" DATE,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" BIGSERIAL NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "no" INTEGER NOT NULL DEFAULT 0,
    "product" VARCHAR(255) NOT NULL,
    "packing" VARCHAR(150),
    "unit" VARCHAR(50),
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quotations" (
    "user_id" BIGINT NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "role_in_quotation" VARCHAR(30),
    "assigned_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_quotations_pkey" PRIMARY KEY ("user_id","quotation_id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(150),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" BIGSERIAL NOT NULL,
    "category_id" BIGINT,
    "quotation_id" BIGINT,
    "channel_id" BIGINT,
    "name" VARCHAR(200) NOT NULL,
    "icon" VARCHAR(20),
    "subject" VARCHAR(255),
    "body" TEXT,
    "wa_template_name" VARCHAR(100),
    "wa_language" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "wa_image" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_template_sends" (
    "id" BIGSERIAL NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "template_id" BIGINT NOT NULL,
    "sent_to" VARCHAR(255),
    "sent_at" TIMESTAMP(6),
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_template_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" BIGSERIAL NOT NULL,
    "template_id" BIGINT,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30),
    "whatsapp_phone" VARCHAR(30),
    "email" VARCHAR(255),
    "address" TEXT,
    "market" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "receive_quotation" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "action" VARCHAR(50),
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by" BIGINT,
    "changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_batches" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "template_id" BIGINT NOT NULL,
    "channel_id" BIGINT,
    "created_by" BIGINT,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "media_id" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PREVIEW',
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "send_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_jobs" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "customer_id" BIGINT,
    "to_name" VARCHAR(255),
    "to_phone" VARCHAR(30),
    "channel" VARCHAR(20) NOT NULL,
    "message" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "message_id" VARCHAR(255),
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "send_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "actor_name" VARCHAR(255),
    "action" VARCHAR(50) NOT NULL,
    "target" VARCHAR(255),
    "result" VARCHAR(20),
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_type_account_id_key" ON "channels"("type", "account_id");

-- CreateIndex
CREATE INDEX "products_market_idx" ON "products"("market");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_code_key" ON "quotations"("code");

-- CreateIndex
CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_customer_id_key" ON "audit_logs"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "send_batches_code_key" ON "send_batches"("code");

-- CreateIndex
CREATE INDEX "send_batches_status_idx" ON "send_batches"("status");

-- CreateIndex
CREATE INDEX "send_jobs_status_idx" ON "send_jobs"("status");

-- CreateIndex (worker gửi + log gửi)
CREATE INDEX "send_jobs_batch_id_idx" ON "send_jobs"("batch_id");
CREATE INDEX "send_jobs_created_at_idx" ON "send_jobs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex (hỗ trợ tìm/lọc/phân trang màn Template)
CREATE INDEX "templates_quotation_id_idx" ON "templates"("quotation_id");
CREATE INDEX "templates_created_at_idx" ON "templates"("created_at");

-- CreateIndex (hỗ trợ tìm/lọc/phân trang màn Khách hàng)
CREATE INDEX "customers_market_idx" ON "customers"("market");
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- Tìm kiếm text nhanh (ILIKE '%...%') — B-tree không giúp được, cần GIN + pg_trgm.
-- Prisma schema không khai được -> chạy SQL tay (bỏ comment để dùng):
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS "templates_name_trgm" ON "templates" USING gin ("name" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "templates_wa_template_name_trgm" ON "templates" USING gin ("wa_template_name" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "customers_phone_trgm" ON "customers" USING gin ("phone" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "customers_whatsapp_phone_trgm" ON "customers" USING gin ("whatsapp_phone" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "customers_email_trgm" ON "customers" USING gin ("email" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quotations" ADD CONSTRAINT "user_quotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quotations" ADD CONSTRAINT "user_quotations_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_template_sends" ADD CONSTRAINT "quotation_template_sends_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_template_sends" ADD CONSTRAINT "quotation_template_sends_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_batches" ADD CONSTRAINT "send_batches_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_batches" ADD CONSTRAINT "send_batches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_batches" ADD CONSTRAINT "send_batches_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "send_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_jobs" ADD CONSTRAINT "send_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- KÊNH NHẬN (receive_channels) + gắn vào inbound_messages
-- Chạy 1 lần trên Supabase SQL Editor (vì db push đang chặn port 5432).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- ============================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "receive_channels" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "api_key_env" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),
    CONSTRAINT "receive_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "receive_channels_type_account_id_key" ON "receive_channels"("type", "account_id");

-- AlterTable: thêm cột kênh nhận cho inbound_messages
ALTER TABLE "inbound_messages" ADD COLUMN IF NOT EXISTS "receive_channel_id" BIGINT;
CREATE INDEX IF NOT EXISTS "inbound_messages_receive_channel_id_idx" ON "inbound_messages"("receive_channel_id");

-- AddForeignKey (Postgres không có IF NOT EXISTS cho constraint -> bọc DO block)
DO $$ BEGIN
  ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_receive_channel_id_fkey"
    FOREIGN KEY ("receive_channel_id") REFERENCES "receive_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- ZALO OA — bảng token OAuth v4 (zalo_oa_tokens) + app_settings
-- Chạy 1 lần trên Supabase SQL Editor (nếu không dùng được `prisma db push`).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- ============================================================

-- Cài đặt hệ thống key-value (waba_id, zalo_oa_id, zalo_pkce...) — có thể đã tồn tại.
CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- Token Zalo OA: 1 dòng / OA. Worker tự làm mới, KHÔNG đặt tay.
CREATE TABLE IF NOT EXISTS "zalo_oa_tokens" (
    "oa_id" VARCHAR(50) NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zalo_oa_tokens_pkey" PRIMARY KEY ("oa_id")
);

-- ============================================================
-- KÍCH HOẠT ZALO cho người dùng: zalo_user_bindings + zalo_link_requests
-- Idempotent — chạy trên Supabase SQL Editor nếu không dùng được `prisma db push`.
-- ============================================================
CREATE TABLE IF NOT EXISTS "zalo_user_bindings" (
    "user_id" BIGINT NOT NULL,
    "zalo_user_id" VARCHAR(50) NOT NULL,
    "zalo_name" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "linked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zalo_user_bindings_pkey" PRIMARY KEY ("user_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_user_bindings_zalo_user_id_key" ON "zalo_user_bindings"("zalo_user_id");
DO $$ BEGIN
  ALTER TABLE "zalo_user_bindings" ADD CONSTRAINT "zalo_user_bindings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "zalo_link_requests" (
    "user_id" BIGINT NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zalo_link_requests_pkey" PRIMARY KEY ("user_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_link_requests_code_key" ON "zalo_link_requests"("code");
DO $$ BEGIN
  ALTER TABLE "zalo_link_requests" ADD CONSTRAINT "zalo_link_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
